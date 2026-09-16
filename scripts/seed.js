#!/usr/bin/env node
/**
 * Seeds a local Soroban sandbox (or testnet) with real contract data so the
 * backend integration tests can read from deployed contracts.
 *
 * Steps:
 *  1. Ensure the source identity exists and is funded.
 *  2. Build (or locate) the three contract WASM binaries.
 *  3. Deploy ScheduleVault, RecurringStream and DCAPolicy.
 *  4. Native XLM (via its Stellar Asset Contract) is used as the token.
 *  5. Approve each contract to spend native XLM on behalf of the source.
 *  6. Create: 1 vault, 2 streams (owner + recipient lookups), 1 DCA policy.
 *
 * Environment variables (all optional):
 *   STELLAR_RPC_URL             RPC endpoint (default http://localhost:8000/soroban/rpc)
 *   STELLAR_NETWORK_PASSPHRASE  Network passphrase (default Standalone Network ; February 2017)
 *   SEED_SOURCE                 CLI identity to fund+deploy+seed (default chrono-deployer)
 *   SEED_RECIPIENT_A            First recipient identity (default chrono-recipient-a)
 *   SEED_RECIPIENT_B            Second recipient identity (default chrono-recipient-b)
 *   VAULT_CONTRACT_ID           Reuse an existing deployed vault contract
 *   STREAM_CONTRACT_ID          Reuse an existing deployed stream contract
 *   DCA_CONTRACT_ID             Reuse an existing deployed dca contract
 *   STELLAR_CLI                 Path to the stellar CLI binary (default `stellar`)
 *
 * On success prints a JSON summary to stdout (logs go to stderr).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const config = {
  rpcUrl: process.env.STELLAR_RPC_URL || 'http://localhost:8000/soroban/rpc',
  networkPassphrase:
    process.env.STELLAR_NETWORK_PASSPHRASE || 'Standalone Network ; February 2017',
  source: process.env.SEED_SOURCE || 'chrono-deployer',
  recipientA: process.env.SEED_RECIPIENT_A || 'chrono-recipient-a',
  recipientB: process.env.SEED_RECIPIENT_B || 'chrono-recipient-b',
  cli: process.env.STELLAR_CLI || 'stellar',
  vaultContractId: process.env.VAULT_CONTRACT_ID || '',
  streamContractId: process.env.STREAM_CONTRACT_ID || '',
  dcaContractId: process.env.DCA_CONTRACT_ID || '',
};

const WASM_NAMES = {
  vault: 'schedule_vault',
  stream: 'recurring_stream',
  dca: 'dca_policy',
};

async function main() {
  log(`Seeding ChronoStar sandbox at ${config.rpcUrl}`);

  ensureIdentity(config.source);
  fundAccount(config.source);
  ensureIdentity(config.recipientA);
  ensureIdentity(config.recipientB);

  const owner = identityAddress(config.source);
  const recipientA = identityAddress(config.recipientA);
  const recipientB = identityAddress(config.recipientB);

  const tokenId = nativeAssetId();

  const vaultContractId = config.vaultContractId || deployContract('vault');
  const streamContractId = config.streamContractId || deployContract('stream');
  const dcaContractId = config.dcaContractId || deployContract('dca');

  const currentLedger = readLedger(vaultContractId);
  log(`Current ledger: ${currentLedger}`);
  const releaseLedger = currentLedger + 1000;
  const expirationLedger = currentLedger + 10000;

  approveSpender(config.source, vaultContractId, tokenId, expirationLedger);
  approveSpender(config.source, streamContractId, tokenId, expirationLedger);
  approveSpender(config.source, dcaContractId, tokenId, expirationLedger);

  createVault(vaultContractId, config.source, recipientA, tokenId, releaseLedger);
  createStream(streamContractId, config.source, recipientA, tokenId, 1);
  createStream(streamContractId, config.source, recipientB, tokenId, 2);
  createDca(dcaContractId, config.source, recipientA, tokenId);

  const summary = {
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    vaultContractId,
    streamContractId,
    dcaContractId,
    tokenContractId: tokenId,
    owner,
    recipientA,
    recipientB,
    counts: { vaults: 1, streams: 2, dcas: 1 },
  };

  console.log(JSON.stringify(summary, null, 2));
}

// ---------- CLI helpers ----------

function runCli(args, options = {}) {
  const result = spawnSync(config.cli, args, {
    encoding: 'utf8',
    env: { ...process.env },
    ...options,
  });
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  return {
    ok: result.status === 0,
    stdout,
    stderr,
    output: [stdout, stderr].join('\n'),
    code: result.status,
  };
}

function ensureIdentity(identity) {
  const result = runCli(['keys', 'generate', identity]);
  if (!result.ok && !/already exists/i.test(result.output)) {
    throw new Error(`Failed to create identity ${identity}: ${result.output}`);
  }
}

function fundAccount(identity) {
  const result = runCli([
    'keys', 'fund', identity,
    '--rpc-url', config.rpcUrl,
    '--network-passphrase', config.networkPassphrase,
  ]);
  if (!result.ok) {
    log(`Warning: funding ${identity} failed (${result.stderr})`);
  }
}

function identityAddress(identity) {
  const result = runCli(['keys', 'address', identity]);
  const match = result.stdout.match(/^G[A-Z0-9]{55}$/);
  if (!result.ok || !match) throw new Error(`Could not resolve ${identity}: ${result.output}`);
  return match[0];
}

function baseCliArgs() {
  return ['--rpc-url', config.rpcUrl, '--network-passphrase', config.networkPassphrase];
}

function nativeAssetId() {
  const result = runCli(['contract', 'id', 'asset', '--asset', 'native', ...baseCliArgs()]);
  const match = result.stdout.match(/^C[A-Z0-9]{55}$/);
  if (!result.ok || !match) throw new Error(`Could not resolve native asset id: ${result.output}`);
  return match[0];
}

function findWasm(name) {
  const candidates = [
    path.join(repoRoot, 'contract', 'target', 'wasm32-unknown-unknown', 'release', `${name}.wasm`),
    path.join(repoRoot, 'contract', 'target', 'wasm32v1-none', 'release', `${name}.wasm`),
    path.join(repoRoot, 'contract', 'target', 'wasm64-unknown-unknown', 'release', `${name}.wasm`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function deployContract(which) {
  const name = WASM_NAMES[which];
  const wasm = findWasm(name);
  if (!wasm) throw new Error(`WASM for ${which} not found. Run \`cargo build --release --target wasm32-unknown-unknown\` in contract/ first.`);

  log(`Deploying ${which}...`);
  const result = runCli(['contract', 'deploy', '--wasm', wasm, '--source', config.source, ...baseCliArgs()]);
  const id = (result.stdout.match(/C[A-Z0-9]{55}/) || [])[0];
  if (!result.ok || !id) throw new Error(`Deploy ${which} failed: ${result.output}`);
  log(`${which} deployed: ${id}`);
  return id;
}

function approveSpender(owner, contractId, tokenId, expirationLedger) {
  log(`Approving ${contractId} to spend native asset...`);
  const result = runCli([
    'contract', 'invoke',
    '--id', tokenId,
    '--source', owner,
    ...baseCliArgs(),
    '--',
    'approve',
    '--from', owner,
    '--spender', contractId,
    '--amount', '500000000',
    '--expiration_ledger', String(expirationLedger),
  ]);
  if (!result.ok) throw new Error(`approve failed for ${contractId}: ${result.output}`);
}

function readLedger(contractId) {
  const result = runCli([
    'contract', 'invoke',
    '--id', contractId,
    '--source', config.source,
    ...baseCliArgs(),
    '--',
    'current_ledger',
  ]);
  if (!result.ok) throw new Error(`current_ledger failed: ${result.output}`);
  const last = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  const ledger = Number(last);
  if (!Number.isInteger(ledger)) throw new Error(`Unexpected current_ledger result: ${last}`);
  return ledger;
}

function createVault(contractId, owner, recipient, tokenId, releaseLedger) {
  log('Creating vault...');
  const result = runCli([
    'contract', 'invoke',
    '--id', contractId,
    '--source', owner,
    ...baseCliArgs(),
    '--',
    'create_vault',
    '--owner', owner,
    '--recipient', recipient,
    '--token', tokenId,
    '--amount', '100000000',
    '--release_ledger', String(releaseLedger),
    '--label', 'Integration test vault',
  ]);
  if (!result.ok) throw new Error(`create_vault failed: ${result.output}`);
}

function createStream(contractId, owner, recipient, tokenId, nth) {
  log(`Creating stream ${nth}...`);
  const result = runCli([
    'contract', 'invoke',
    '--id', contractId,
    '--source', owner,
    ...baseCliArgs(),
    '--',
    'create_stream',
    '--owner', owner,
    '--recipient', recipient,
    '--token', tokenId,
    '--total_amount', String(20000000 + nth),
    '--duration_ledgers', '10000',
    '--label', `Integration test stream ${nth}`,
  ]);
  if (!result.ok) throw new Error(`create_stream failed: ${result.output}`);
}

function createDca(contractId, owner, swapReceiver, tokenId) {
  log('Creating DCA policy...');
  const result = runCli([
    'contract', 'invoke',
    '--id', contractId,
    '--source', owner,
    ...baseCliArgs(),
    '--',
    'create_dca',
    '--owner', owner,
    '--token_in', tokenId,
    '--swap_receiver', swapReceiver,
    '--total_budget', '30000000',
    '--amount_per_swap', '3000000',
    '--interval_ledgers', '10000',
    '--label', 'Integration test dca',
  ]);
  if (!result.ok) throw new Error(`create_dca failed: ${result.output}`);
}

function log(message) {
  process.stderr.write(`[seed] ${message}\n`);
}

main().catch((err) => {
  log(err.stack || err.message);
  process.exit(1);
});