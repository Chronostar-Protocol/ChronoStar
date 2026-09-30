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
    scvU32: (v) => v,
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

describe('GET /api/dca/:address/:id/history', () => {
  function historyClient(records = [{ index: 1, amount_in: 100, amount_out: 95 }]) {
    const client = mockClient();
    client.readContract.mock.mockImplementation(async (id, method) => {
      if (method === 'get_dcas_by_owner') return [1];
      if (method === 'get_execution_history') return records;
      return null;
    });
    return client;
  }

  function historyApp(client) {
    const app = express();
    app.use('/api/dca', createDCARouter(client, 'C...'));
    return app;
  }

  it('returns execution records for the DCA', async () => {
    const client = historyClient();
    const res = await request(historyApp(client)).get(`/api/dca/${VALID_ADDRESS}/1/history`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.dcaId, 1);
    assert.strictEqual(res.body.start, 1);
    assert.strictEqual(res.body.limit, 50);
    assert.strictEqual(res.body.executions.length, 1);
    assert.strictEqual(res.body.executions[0].amount_out, 95);
  });

  it('passes pagination params through as u32 args', async () => {
    const client = historyClient([]);
    const res = await request(historyApp(client)).get(
      `/api/dca/${VALID_ADDRESS}/1/history?start=3&limit=10`,
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.start, 3);
    assert.strictEqual(res.body.limit, 10);
    assert.deepStrictEqual(res.body.executions, []);

    const call = client.readContract.mock.calls.find(c => c[1] === 'get_execution_history');
    assert.deepStrictEqual(call[2], [1, 3, 10]);
  });

  it('clamps limit to 50', async () => {
    const client = historyClient([]);
    const res = await request(historyApp(client)).get(`/api/dca/${VALID_ADDRESS}/1/history?limit=500`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.limit, 50);
  });

  it('falls back to defaults for unparseable pagination params', async () => {
    const client = historyClient([]);
    const res = await request(historyApp(client)).get(
      `/api/dca/${VALID_ADDRESS}/1/history?start=abc&limit=-4`,
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.start, 1);
    assert.strictEqual(res.body.limit, 50);
  });

  it('returns 404 when the DCA is not owned by the address', async () => {
    const client = historyClient([]);
    client.readContract.mock.mockImplementation(async (id, method) => {
      if (method === 'get_dcas_by_owner') return [7];
      return null;
    });

    const res = await request(historyApp(client)).get(`/api/dca/${VALID_ADDRESS}/1/history`);
    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /not found/);
  });

  it('returns 404 when the address owns no DCAs', async () => {
    const client = mockClient();
    client.readContract.mock.mockImplementation(async () => null);

    const res = await request(historyApp(client)).get(`/api/dca/${VALID_ADDRESS}/1/history`);
    assert.strictEqual(res.status, 404);
  });

  it('rejects a non-numeric DCA id', async () => {
    const client = historyClient([]);
    const res = await request(historyApp(client)).get(`/api/dca/${VALID_ADDRESS}/abc/history`);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid DCA id/);
  });

  it('rejects a zero DCA id', async () => {
    const client = historyClient([]);
    const res = await request(historyApp(client)).get(`/api/dca/${VALID_ADDRESS}/0/history`);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid DCA id/);
  });

  it('rejects invalid address format', async () => {
    const client = historyClient([]);
    const res = await request(historyApp(client)).get('/api/dca/tooshort/1/history');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid Stellar address/);
  });
});
