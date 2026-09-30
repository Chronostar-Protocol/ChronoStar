import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RpcEndpointPool } from './rpc-endpoint-pool.js';

describe('RpcEndpointPool', () => {
  it('fails over and returns to a recovered primary endpoint', async () => {
    let primaryHealthy = false;
    const calls = [];
    const pool = new RpcEndpointPool(['primary', 'secondary'], (url) => ({
      request: async () => {
        calls.push(url);
        if (url === 'primary' && !primaryHealthy) throw new Error('offline');
        return url;
      },
    }));
    assert.equal(await pool.call('request'), 'secondary');
    primaryHealthy = true;
    assert.equal(await pool.call('request'), 'primary');
    assert.deepEqual(calls, ['primary', 'secondary', 'primary']);
    assert.deepEqual(pool.metrics(), [
      { url: 'primary', successes: 1, failures: 1, healthy: true },
      { url: 'secondary', successes: 1, failures: 0, healthy: true },
    ]);
  });

  it('preserves the error when every endpoint fails', async () => {
    const pool = new RpcEndpointPool(['one'], () => ({ request: async () => { throw new Error('unavailable'); } }));
    await assert.rejects(pool.call('request'), /unavailable/);
    assert.equal(pool.metrics()[0].failures, 1);
  });
});
