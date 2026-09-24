import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from './store.js';

let directory;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('EventStore', () => {
  it('persists events and reloads them after a new instance', async () => {
    directory = await mkdtemp(join(tmpdir(), 'chronostar-store-'));
    const path = join(directory, 'events.json');
    const event = { type: 'vault', id: 1, targetLedger: 120 };
    await new EventStore(path).append(event);
    assert.deepEqual(await new EventStore(path).list(), [{ ...event, key: 'vault:1:120' }]);
    assert.ok((await readFile(path, 'utf8')).includes('vault'));
  });
});
