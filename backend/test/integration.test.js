import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';

const RPC_URL = process.env.STELLAR_RPC_URL || 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';
const STELLAR_CLI = process.env.STELLAR_CLI || 'stellar';
const AUTO_START_SANDBOX = process.env.AUTO_START_SANDBOX !== '0';
const SKIP_SEED = process.env.CHRONOSTAR_SKIP_SEED === '1';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '..', '..');
const seedScript = path.join(repoRoot, 'scripts', 'seed.js');

let app;
let seeded;
let sandboxStartedHere = false;

async function sandboxHealthy() {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: {} }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.result?.status === 'healthy';
  } catch {
    return false;
  }
}

async function startSandbox() {
  const result = spawnSync(STELLAR_CLI, ['container', 'start', 'local', '--limits', 'unlimited'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to start local sandbox: ${result.stderr || result.stdout}`);
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await sandboxHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Timed out waiting for the local sandbox RPC to become healthy');
}

async function ensureSandbox() {
  if (await sandboxHealthy()) return;
  if (!AUTO_START_SANDBOX) {
    throw new Error(
      `No healthy Soroban sandbox at ${RPC_URL}. Start one with \`stellar container start local\` (or set AUTO_START_SANDBOX=1).`,
    );
  }
  sandboxStartedHere = true;
  await startSandbox();
}

function runSeed() {
  const env = {
    ...process.env,
    STELLAR_RPC_URL: RPC_URL,
    STELLAR_NETWORK_PASSPHRASE: NETWORK_PASSPHRASE,
  };
  const stdout = execFileSync(process.execPath, [seedScript], { encoding: 'utf8', env });
  return JSON.parse(stdout.trim());
}

async function resolveSeededContracts() {
  const providedVault = process.env.VAULT_CONTRACT_ID;
  const providedStream = process.env.STREAM_CONTRACT_ID;
  const providedDca = process.env.DCA_CONTRACT_ID;
  if (SKIP_SEED && providedVault && providedStream && providedDca) {
    return { vault: providedVault, stream: providedStream, dca: providedDca, counts: null };
  }
  const seed = runSeed();
  return {
    vault: seed.vaultContractId,
    stream: seed.streamContractId,
    dca: seed.dcaContractId,
    owner: seed.owner,
    recipientA: seed.recipientA,
    recipientB: seed.recipientB,
    counts: seed.counts,
  };
}

before(async () => {
  await ensureSandbox();
  seeded = await resolveSeededContracts();

  process.env.STELLAR_RPC_URL = RPC_URL;
  process.env.STELLAR_NETWORK_PASSPHRASE = NETWORK_PASSPHRASE;
  process.env.VAULT_CONTRACT_ID = seeded.vault;
  process.env.STREAM_CONTRACT_ID = seeded.stream;
  process.env.DCA_CONTRACT_ID = seeded.dca;

  const { SorobanClient } = await import('../src/soroban-client.js');
  const { createApp } = await import('../src/app.js');

  const client = new SorobanClient();
  app = createApp({
    vault: { client, contractId: seeded.vault },
    stream: { client, contractId: seeded.stream },
    dca: { client, contractId: seeded.dca },
  });
});

after(async () => {
  if (sandboxStartedHere && process.env.KEEP_SANDBOX !== '1') {
    spawnSync(STELLAR_CLI, ['container', 'stop', 'local'], { encoding: 'utf8' });
  }
});

describe('Backend integration against a local Soroban sandbox', () => {
  it('GET /healthz responds ok', async () => {
    const res = await request(app).get('/healthz');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'ok' });
  });

  it('GET /api/stats reads real seeded counts from the deployed contracts', async () => {
    const res = await request(app).get('/api/stats');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.vaults.total >= 1);
    assert.ok(res.body.streams.total >= 2);
    assert.ok(res.body.dca.total >= 1);
  });

  it('GET /api/events surfaces seeded active events', async () => {
    const res = await request(app).get('/api/events?limit=50');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.length >= 1);
    const types = new Set(res.body.map((e) => e.type));
    assert.ok(types.has('vault'));
    assert.ok(types.has('stream'));
    assert.ok(types.has('dca'));
    for (const event of res.body) {
      assert.ok(event.targetLedger > 0);
      assert.ok(event.remainingLedgers >= 0);
    }
  });

  it('GET /api/schedules/:address returns seeded vaults for the owner', async () => {
    const res = await request(app).get(`/api/schedules/${seeded.owner}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.some((v) => v.owner === seeded.owner && v.amount >= 1));
  });

  it('GET /api/schedules/:address returns an empty array for a stranger', async () => {
    const res = await request(app).get(`/api/schedules/${seeded.recipientB}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, []);
  });

  it('GET /api/streams/:address returns streams where the address is owner or recipient', async () => {
    const ownerRes = await request(app).get(`/api/streams/${seeded.owner}`);
    assert.strictEqual(ownerRes.status, 200);
    assert.ok(ownerRes.body.length >= 1);
    assert.ok(ownerRes.body.every((s) => s.total_amount >= 1));

    const recipientRes = await request(app).get(`/api/streams/${seeded.recipientA}`);
    assert.strictEqual(recipientRes.status, 200);
    assert.ok(recipientRes.body.length >= 1);
  });

  it('GET /api/dca/:address returns seeded DCA policies for the owner', async () => {
    const res = await request(app).get(`/api/dca/${seeded.owner}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.every((d) => d.total_budget >= 1));
  });

  it('validates addresses on real routes', async () => {
    for (const route of ['schedules', 'streams', 'dca']) {
      const res = await request(app).get(`/api/${route}/not-a-valid-address`);
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /Invalid Stellar address/);
    }
  });
});