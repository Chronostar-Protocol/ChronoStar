import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ContractSimulationError, SorobanClient } from './soroban-client.js';

const rawSimulation = JSON.parse(
  readFileSync(new URL('../test/fixtures/soroban-read-response.json', import.meta.url), 'utf8'),
);

describe('SorobanClient.readContract', () => {
  it('replays a raw simulation response through the SDK decoder', async () => {
    const client = new SorobanClient();
    client.server._simulateTransaction = mock.fn(async () => rawSimulation);
    client.simulate = mock.fn(() => client.server.simulateTransaction());

    const result = await client.readContract(
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      'get_record',
      [],
    );

    assert.deepStrictEqual(result, {
      id: '18446744073709551615',
      amount: '9007199254740993',
      safeCount: Number.MAX_SAFE_INTEGER,
      status: 0,
      optional: 99,
      absent: null,
      nested: {
        maybe: 7,
        absent: null,
        status: 1,
        values: ['a', 'b'],
      },
    });
    assert.strictEqual(client.server._simulateTransaction.mock.callCount(), 1);
  });

  it('throws a typed upstream error for a failed simulation', async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ error: 'contract invocation failed' }));

    await assert.rejects(
      client.readContract('CBAD', 'get', []),
      (error) =>
        error instanceof ContractSimulationError &&
        error.statusCode === 502 &&
        error.message.includes('contract invocation failed'),
    );
  });

  it('keeps null for a successful simulation with no return value', async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ result: {} }));

    assert.strictEqual(await client.readContract('CEMPTY', 'get', []), null);
  });
});
