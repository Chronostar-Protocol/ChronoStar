import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createServer } from './http.js';

describe('keeper health', () => {
  it('reports the observed stalled ledger and degrades health', async () => {
    const client = {
      ledgerStatus: () => ({
        status: 'stalled',
        stalled: true,
        observedLedger: 123,
        lastAdvancedAt: 1_000,
        stallDurationMs: 120_000,
        maxStallDurationMs: 120_000,
      }),
    };
    const server = createServer({}, client, 0);
    await new Promise((resolve) => server.once('listening', resolve));

    try {
      const response = await new Promise((resolve, reject) => {
        const request = get(`http://127.0.0.1:${server.address().port}/healthz`, (httpResponse) => {
          let body = '';
          httpResponse.setEncoding('utf8');
          httpResponse.on('data', (chunk) => { body += chunk; });
          httpResponse.on('end', () => resolve({ statusCode: httpResponse.statusCode, body: JSON.parse(body) }));
        });
        request.on('error', reject);
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.status, 'degraded');
      assert.equal(response.body.ledger, 123);
      assert.equal(response.body.ledgerStall.status, 'stalled');
      assert.equal(response.body.ledgerStall.stallDurationMs, 120_000);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});