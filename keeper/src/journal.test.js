import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { TransactionJournal } from './journal.js';

const TEST_JOURNAL_PATH = path.join(process.cwd(), '.test-journal.json');

describe('TransactionJournal', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_JOURNAL_PATH)) {
      fs.unlinkSync(TEST_JOURNAL_PATH);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_JOURNAL_PATH)) {
      fs.unlinkSync(TEST_JOURNAL_PATH);
    }
  });

  it('records pending submission and persists to disk', () => {
    const journal = new TransactionJournal({ journalPath: TEST_JOURNAL_PATH, maxEntries: 10 });
    const entry = journal.recordSubmission({
      actionKey: 'vault:release',
      contractId: 'CAAA',
      method: 'release',
      txHash: 'hash-123',
      correlationId: 'corr-123',
      feeStroops: 5000,
    });

    assert.strictEqual(entry.status, 'PENDING');
    assert.strictEqual(entry.txHash, 'hash-123');
    assert.strictEqual(journal.getPendingEntries().length, 1);

    // Verify persisted
    const raw = fs.readFileSync(TEST_JOURNAL_PATH, 'utf8');
    const data = JSON.parse(raw);
    assert.strictEqual(data.entries.length, 1);
    assert.strictEqual(data.entries[0].txHash, 'hash-123');
  });

  it('updates entry to settled upon settlement', () => {
    const journal = new TransactionJournal({ journalPath: TEST_JOURNAL_PATH });
    journal.recordSubmission({
      actionKey: 'vault:release',
      contractId: 'CAAA',
      method: 'release',
      txHash: 'hash-123',
      correlationId: 'corr-123',
    });

    journal.recordSettlement({
      txHash: 'hash-123',
      status: 'SUCCESS',
    });

    assert.strictEqual(journal.getPendingEntries().length, 0);
    const entries = journal.getEntries();
    assert.strictEqual(entries[0].status, 'SUCCESS');
    assert.ok(entries[0].settledAt);
  });

  it('prunes oldest settled entries when exceeding maxEntries while retaining pending', () => {
    const journal = new TransactionJournal({ journalPath: TEST_JOURNAL_PATH, maxEntries: 3 });

    journal.recordSubmission({ actionKey: 'k1', txHash: 'h1' });
    journal.recordSettlement({ txHash: 'h1', status: 'SUCCESS' });

    journal.recordSubmission({ actionKey: 'k2', txHash: 'h2' });
    journal.recordSettlement({ txHash: 'h2', status: 'SUCCESS' });

    journal.recordSubmission({ actionKey: 'k3', txHash: 'h3' }); // PENDING

    journal.recordSubmission({ actionKey: 'k4', txHash: 'h4' });
    journal.recordSettlement({ txHash: 'h4', status: 'SUCCESS' });

    const entries = journal.getEntries();
    assert.strictEqual(entries.length, 3);
    // h3 (pending) must be preserved
    assert.ok(entries.some((e) => e.txHash === 'h3'));
  });

  it('reconciles pending entries with server during restart recovery', async () => {
    const journal = new TransactionJournal({ journalPath: TEST_JOURNAL_PATH });
    journal.recordSubmission({ actionKey: 'k1', txHash: 'h-success' });
    journal.recordSubmission({ actionKey: 'k2', txHash: 'h-failed' });
    journal.recordSubmission({ actionKey: 'k3', txHash: 'h-pending' });

    const fakeServer = {
      getTransaction: async (hash) => {
        if (hash === 'h-success') return { status: 'SUCCESS' };
        if (hash === 'h-failed') return { status: 'FAILED', errorResultXdr: 'error_xdr' };
        return { status: 'PENDING' };
      },
    };

    const res = await journal.reconcile(fakeServer);
    assert.strictEqual(res.reconciled, 2);
    assert.strictEqual(res.pending, 1);

    const pending = journal.getPendingEntries();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].txHash, 'h-pending');
  });
});
