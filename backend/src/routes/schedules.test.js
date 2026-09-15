import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { createSchedulesRouter } from './schedules.js';

const VALID_ADDRESS = 'GBXGQJYF4VCR6J7QCRDMYNCHTSONGZXYQHG7OFNZFLZJGXA7ZUGA7AJE';

function mockClient() {
  return {
    readContract: mock.fn(),
    scvU64: (v) => v,
    scvAddress: (a) => a,
  };
}

function appWithRouter(client) {
  const app = express();
  app.use('/api/schedules', createSchedulesRouter(client, 'C...'));
  return app;
}

describe('GET /api/schedules/:address', () => {
  it('returns vaults for an address', async () => {
    const client = mockClient();
    client.readContract.mock.mockImplementation(async (id, method, args) => {
      if (method === 'get_vaults_by_owner') {
        return [1, 2];
      }
      if (method === 'get_vault') {
        const id = args[0];
        return { id, owner: 'G...', amount: id === 1 ? 1000 : 2000, status: 0 };
      }
      return null;
    });

    const res = await request(appWithRouter(client)).get(`/api/schedules/${VALID_ADDRESS}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    assert.strictEqual(res.body[0].amount, 1000);
  });

  it('returns empty array when no vaults', async () => {
    const client = mockClient();
    client.readContract.mock.mockImplementation(() => null);

    const res = await request(appWithRouter(client)).get(`/api/schedules/${VALID_ADDRESS}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, []);
  });

  it('rejects invalid address format', async () => {
    const client = mockClient();
    const res = await request(appWithRouter(client)).get('/api/schedules/not-a-valid-key');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Invalid Stellar address/);
  });
});
