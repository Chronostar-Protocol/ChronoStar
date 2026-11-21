import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createEventStore,
  FileEventStore,
  EventStoreCorruptionError,
  EventStoreValidationError,
  validateEventRecord,
} from './store.js';

const FIXTURES_DIR = resolve('test/fixtures');

describe('EventStore Drivers', () => {
  const sampleEvent = { type: 'vault', id: 1, targetLedger: 1000 };

  for (const driverName of ['memory', 'file', 'postgres', 'sqlite']) {
    it(`driver "${driverName}" implements append, load, and list`, async () => {
      const store = createEventStore(driverName);
      const initial = await store.load();
      assert.strictEqual(Array.isArray(initial), true);

      const appended = await store.append(sampleEvent);
      assert.strictEqual(appended.length > 0, true);

      const listed = await store.list(10);
      assert.strictEqual(listed.length > 0, true);
      assert.strictEqual(listed[0].type, 'vault');
    });
  }
});

describe('FileEventStore record validation and error distinction', () => {
  it('loads valid event records from fixture', async () => {
    const validPath = resolve(FIXTURES_DIR, 'events-valid.json');
    const store = new FileEventStore(validPath);
    const events = await store.load();
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'vault');
    assert.strictEqual(events[0].id, 1);
    assert.strictEqual(events[0].targetLedger, 1000);
    assert.strictEqual(events[1].type, 'stream');
  });

  it('distinguishes malformed JSON and throws EventStoreCorruptionError without wiping file', async () => {
    const truncatedPath = resolve(FIXTURES_DIR, 'events-truncated.json');
    const originalContent = await readFile(truncatedPath, 'utf8');
    const store = new FileEventStore(truncatedPath);

    await assert.rejects(
      async () => {
        await store.load();
      },
      (err) => {
        assert.ok(err instanceof EventStoreCorruptionError);
        assert.strictEqual(err.code, 'ERR_EVENT_STORE_CORRUPT_JSON');
        assert.strictEqual(err.filePath, truncatedPath);
        assert.ok(err.message.includes('Malformed JSON'));
        return true;
      }
    );

    // Verify file is preserved for recovery and not overwritten
    const afterContent = await readFile(truncatedPath, 'utf8');
    assert.strictEqual(afterContent, originalContent);
  });

  it('distinguishes malformed records and throws EventStoreValidationError with field identification', async () => {
    const invalidPath = resolve(FIXTURES_DIR, 'events-invalid-record.json');
    const originalContent = await readFile(invalidPath, 'utf8');
    const store = new FileEventStore(invalidPath);

    await assert.rejects(
      async () => {
        await store.load();
      },
      (err) => {
        assert.ok(err instanceof EventStoreValidationError);
        assert.strictEqual(err.code, 'ERR_EVENT_STORE_INVALID_RECORD');
        assert.strictEqual(err.filePath, invalidPath);
        assert.strictEqual(err.index, 1);
        assert.strictEqual(err.field, 'targetLedger');
        assert.ok(err.message.includes("missing or invalid field 'targetLedger'"));
        return true;
      }
    );

    // Verify file is preserved
    const afterContent = await readFile(invalidPath, 'utf8');
    assert.strictEqual(afterContent, originalContent);
  });

  it('rejects non-array top-level JSON structure', async () => {
    const notArrayPath = resolve(FIXTURES_DIR, 'events-not-array.json');
    const store = new FileEventStore(notArrayPath);

    await assert.rejects(
      async () => {
        await store.load();
      },
      (err) => {
        assert.ok(err instanceof EventStoreValidationError);
        assert.strictEqual(err.field, 'root');
        assert.ok(err.message.includes('expected top-level array'));
        return true;
      }
    );
  });

  it('unit validates individual records against schema', () => {
    const filePath = 'data/test.json';
    assert.strictEqual(validateEventRecord({ type: 'vault', id: 1, targetLedger: 100 }, 0, filePath), true);
    assert.strictEqual(validateEventRecord({ type: 'stream', id: 'abc', targetLedger: '500' }, 0, filePath), true);

    // Missing or invalid type
    assert.throws(
      () => validateEventRecord({ id: 1, targetLedger: 100 }, 0, filePath),
      /missing or invalid field 'type'/
    );
    assert.throws(
      () => validateEventRecord({ type: '  ', id: 1, targetLedger: 100 }, 0, filePath),
      /missing or invalid field 'type'/
    );

    // Missing or invalid id
    assert.throws(
      () => validateEventRecord({ type: 'vault', targetLedger: 100 }, 0, filePath),
      /missing or invalid field 'id'/
    );

    // Missing or invalid targetLedger
    assert.throws(
      () => validateEventRecord({ type: 'vault', id: 1 }, 0, filePath),
      /missing or invalid field 'targetLedger'/
    );
    assert.throws(
      () => validateEventRecord({ type: 'vault', id: 1, targetLedger: -5 }, 0, filePath),
      /missing or invalid field 'targetLedger'/
    );
  });
});
