import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { createEventsRouter } from './events.js';
import { genReqId } from '../middleware.js';

describe('genReqId', () => {
  it('reuses the X-Correlation-ID header when present', () => {
    const req = { headers: { 'x-correlation-id': 'corr-123' } };
    const res = { setHeader(name, value) { this.headers[name] = value; }, headers: {} };

    const id = genReqId(req, res);

    assert.strictEqual(id, 'corr-123');
    assert.strictEqual(res.headers['X-Correlation-ID'], 'corr-123');
  });

  it('generates a unique ID when no correlation header is present', () => {
    const req = { headers: {} };
    const res = { setHeader(name, value) { this.headers[name] = value; }, headers: {} };

    const first = genReqId(req, res);
    const second = genReqId(req, res);

    assert.ok(first);
    assert.ok(second);
    assert.notStrictEqual(first, second);
    assert.strictEqual(res.headers['X-Correlation-ID'], second);
  });
});

describe('GET /api/events', () => {
  it('returns upcoming events sorted by remaining ledgers', async () => {
    const client = {
      readContract: mock.fn(),
      scvU64: (v) => v,
    };

    client.readContract.mock.mockImplementation(async (id, method, args) => {
      if (method === 'vault_count') return 1;
      if (method === 'stream_count') return 0;
      if (method === 'dca_count') return 0;
      if (method === 'current_ledger') return 100;
      if (method === 'get_vault') return { status: 0, release_ledger: 150 };
      return null;
    });

    const clients = {
      vault: { client, contractId: 'C...' },
      stream: { client, contractId: 'C...' },
      dca: { client, contractId: 'C...' },
    };

    const app = express();
    app.use('/api/events', createEventsRouter(clients));

    const res = await request(app).get('/api/events?limit=10');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].remainingLedgers, 50);
  });

  it('logs with the correlation ID threaded from the request', async () => {
    const client = {
      readContract: mock.fn(async () => 0),
      scvU64: (v) => v,
    };

    const clients = {
      vault: { client, contractId: 'C...' },
      stream: { client, contractId: 'C...' },
      dca: { client, contractId: 'C...' },
    };

    const info = mock.fn();
    const logger = { info };

    const app = express();
    app.use((req, _res, next) => {
      req.id = 'corr-123';
      next();
    });
    app.use('/api/events', createEventsRouter(clients, logger));

    const res = await request(app).get('/api/events');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(info.mock.callCount(), 1);
    assert.deepStrictEqual(info.mock.calls[0].arguments[0], { correlationId: 'corr-123' });
  });
});
