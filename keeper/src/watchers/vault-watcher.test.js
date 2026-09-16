import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { VaultWatcher } from './vault-watcher.js';

function mockReadContract(responses) {
  let i = 0;
  return mock.fn(() => Promise.resolve(responses[i++]));
}

function mockLogger() {
  const child = { info: mock.fn(), error: mock.fn() };
  return { child: mock.fn(() => child), info: mock.fn(), error: mock.fn() };
}

describe('VaultWatcher', () => {
  it('triggers release for a due vault', async () => {
    const invokeContract = mock.fn();
    const client = {
      readContract: mockReadContract([100, 1, [{ status: ['Active'], release_ledger: 100 }]]),
      invokeContract,
    };

    const watcher = new VaultWatcher(client, 'C...');
    await watcher.poll();

    assert.strictEqual(invokeContract.mock.callCount(), 1);
    assert.strictEqual(invokeContract.mock.calls[0].arguments[1], 'release');
  });

  it('attaches a correlation ID to all log entries in a poll cycle', async () => {
    const invokeContract = mock.fn();
    const client = {
      readContract: mockReadContract([100, 1, [{ status: ['Active'], release_ledger: 100 }]]),
      invokeContract,
    };
    const parent = mockLogger();

    const watcher = new VaultWatcher(client, 'C...', parent);
    await watcher.poll();

    assert.strictEqual(parent.child.mock.callCount(), 1);
    const [bindings] = parent.child.mock.calls[0].arguments;
    assert.ok(bindings.correlationId);
    const cycleLogger = parent.child.mock.calls[0].result;
    assert.ok(cycleLogger);
    assert.strictEqual(cycleLogger.info.mock.callCount(), 2);
    assert.strictEqual(cycleLogger.error.mock.callCount(), 0);
  });

  it('generates a unique correlation ID per poll cycle', async () => {
    const client = {
      readContract: mockReadContract([100, 1, [{ status: ['Active'], release_ledger: 100 }]]),
      invokeContract: mock.fn(),
    };
    const parent = mockLogger();

    const watcher = new VaultWatcher(client, 'C...', parent);
    await watcher.poll();
    await watcher.poll();

    assert.strictEqual(parent.child.mock.callCount(), 2);
    const first = parent.child.mock.calls[0].arguments[0].correlationId;
    const second = parent.child.mock.calls[1].arguments[0].correlationId;
    assert.notStrictEqual(first, second);
  });

  it('skips non-due vaults', async () => {
    const invokeContract = mock.fn();
    const client = {
      readContract: mockReadContract([50, 1, [{ status: ['Active'], release_ledger: 100 }]]),
      invokeContract,
    };

    const watcher = new VaultWatcher(client, 'C...');
    await watcher.poll();

    assert.strictEqual(invokeContract.mock.callCount(), 0);
  });

  it('skips non-active vaults', async () => {
    const invokeContract = mock.fn();
    const client = {
      readContract: mockReadContract([100, 1, [{ status: ['Released'], release_ledger: 50 }]]),
      invokeContract,
    };

    const watcher = new VaultWatcher(client, 'C...');
    await watcher.poll();

    assert.strictEqual(invokeContract.mock.callCount(), 0);
  });
});

