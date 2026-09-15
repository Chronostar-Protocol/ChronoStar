import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { createStreamsRouter, createDCARouter } from './streams.js';

const VALID_ADDRESS = 'GBXGQJYF4VCR6J7QCRDMYNCHTSONGZXYQHG7OFNZFLZJGXA7ZUGA7AJE';

function mockClient() {
  return {
    readContract: mock.fn(),
    scvU64: (v) => v,
    scvAddress: (a) => a,
  };
}

describe('GET /api/streams/:address', () => {
  it('returns streams for an address', async () => {
    const client = mockClient();
    const router = createStreamsRouter(client, 'C...');

    client.readContract.mock.mockImplementation(async (id, method, args) => {
      if (method === 'get_streams_by_owner') return [1];
      if (method === 'get_streams_by_recipient') return null;
      if (method === 'get_stream') return { id: 1, total_amount: 5000, status: 0 };
      return null;
    });

    const app = express();
    app.use('/api/streams', router);

    const res = await request(app).get(`/api/streams/${VALID_ADDRESS}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].total_amount, 5000);
  });

  it('rejects invalid address format', async () => {
    const client = mockClient();
    const app = express();
    app.use('/api/streams', createStreamsRouter(client, 'C...'));

    const res = await request(app).get('/api/streams/not-valid');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid Stellar address/);
  });
});

describe('GET /api/dca/:address', () => {
  it('returns DCA policies for an address', async () => {
    const client = mockClient();
    const router = createDCARouter(client, 'C...');

    client.readContract.mock.mockImplementation(async (id, method, args) => {
      if (method === 'get_dcas_by_owner') return [1];
      if (method === 'get_dca') return { id: 1, total_budget: 10000, status: 0 };
      return null;
    });

    const app = express();
    app.use('/api/dca', router);

    const res = await request(app).get(`/api/dca/${VALID_ADDRESS}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].total_budget, 10000);
  });

  it('rejects invalid address format', async () => {
    const client = mockClient();
    const app = express();
    app.use('/api/dca', createDCARouter(client, 'C...'));

    const res = await request(app).get('/api/dca/tooshort');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid Stellar address/);
  });
});
