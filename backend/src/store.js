import { mkdir, readFile, rename, writeFile, open, unlink, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_PATH = resolve(process.env.EVENT_STORE_PATH || 'data/events.json');

/**
 * Validates an event record structure.
 */
export function isValidEventRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (typeof record.type !== 'string' || !record.type) return false;
  if (record.id === undefined || record.id === null) return false;
  return true;
}

/**
 * Base abstract EventStore interface.
 */
export class BaseEventStore {
  async load() {
    throw new Error('BaseEventStore.load() must be implemented');
  }

  async append(_events) {
    throw new Error('BaseEventStore.append() must be implemented');
  }

  async list(_limit = 50) {
    throw new Error('BaseEventStore.list() must be implemented');
  }
}

/**
 * File-backed JSON EventStore driver.
 */
export class FileEventStore extends BaseEventStore {
  constructor(filePath = DEFAULT_PATH, maxEvents = 10_000, log = console) {
    super();
    this.filePath = filePath;
    this.maxEvents = maxEvents;
    this.events = null;
    this.writeQueue = Promise.resolve();
    this.lastWriteError = null;
    this.log = log;
  }

  async withLock(action) {
    const lockPath = `${this.filePath}.lock`;
    let lockFd = null;
    try {
      try {
        lockFd = await open(lockPath, 'wx');
        await lockFd.writeFile(`${process.pid}\n${Date.now()}`);
      } catch (err) {
        if (err.code === 'EEXIST') {
          try {
            const st = await stat(lockPath);
            if (Date.now() - st.mtimeMs > 30000) {
              await unlink(lockPath).catch(() => {});
              lockFd = await open(lockPath, 'wx');
            } else {
              throw new Error(`Event store is locked by another process (${lockPath})`);
            }
          } catch {
            throw new Error(`Event store is locked by another process (${lockPath})`);
          }
        } else {
          throw err;
        }
      }
      return await action();
    } finally {
      if (lockFd) {
        try { await lockFd.close(); } catch {}
        try { await unlink(lockPath); } catch {}
      }
    }
  }

  async load() {
    if (this.events) return this.events;
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents);
      if (Array.isArray(parsed)) {
        this.events = parsed.filter((record) => {
          const valid = isValidEventRecord(record);
          if (!valid) {
            this.log.warn?.({ record }, 'discarding invalid event store record');
          }
          return valid;
        });
      } else {
        this.events = [];
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.events = [];
    }
    return this.events;
  }

  async append(events) {
    const incoming = Array.isArray(events) ? events : [events];
    const current = await this.load();
    const known = new Set(current.map((event) => event.key));
    const additions = incoming
      .map((event) => ({ ...event, key: event.key || `${event.type}:${event.id}:${event.targetLedger}` }))
      .filter((event) => {
        if (!isValidEventRecord(event)) return false;
        if (known.has(event.key)) return false;
        known.add(event.key);
        return true;
      });
    if (!additions.length) return current;
    this.events = [...current, ...additions].slice(-this.maxEvents);
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await this.withLock(async () => {
        const temporaryPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        const handle = await open(temporaryPath, 'w');
        await handle.writeFile(JSON.stringify(this.events, null, 2));
        await handle.sync();
        await handle.close();
        await rename(temporaryPath, this.filePath);
      });
    });
    // Keep the shared queue fulfilled after a failure so one transient disk
    // error cannot poison every later append. The individual caller still
    // receives the original rejection.
    this.writeQueue = write.catch(() => undefined);
    try {
      await write;
      this.lastWriteError = null;
    } catch (error) {
      this.lastWriteError = error;
      this.log.error?.({ err: error }, 'event store write failed');
      throw error;
    }
    return this.events;
  }

  async backup(backupPath) {
    const events = await this.load();
    const raw = JSON.stringify(events, null, 2);
    const checksum = createHash('sha256').update(raw).digest('hex');
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, raw);
    await writeFile(`${backupPath}.sha256`, checksum);
    return { backupPath, checksum, count: events.length };
  }

  async restore(backupPath) {
    const raw = await readFile(backupPath, 'utf8');
    const actualChecksum = createHash('sha256').update(raw).digest('hex');
    try {
      const expectedChecksum = (await readFile(`${backupPath}.sha256`, 'utf8')).trim();
      if (expectedChecksum && actualChecksum !== expectedChecksum) {
        throw new Error(`Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid backup: content is not an array');
    this.events = parsed.filter(isValidEventRecord);
    await this.append([]); // trigger atomic write
    return { restoredCount: this.events.length, checksum: actualChecksum };
  }

  getWriteStatus() {
    return {
      healthy: this.lastWriteError === null,
      lastError: this.lastWriteError?.message ?? null,
    };
  }

  async list(limit = 50) {
    const events = await this.load();
    return events.slice(-limit).reverse();
  }
}

// Backward compatibility export
export const EventStore = FileEventStore;

/**
 * In-Memory EventStore driver.
 */
export class InMemoryEventStore extends BaseEventStore {
  constructor(maxEvents = 10_000) {
    super();
    this.maxEvents = maxEvents;
    this.events = [];
  }

  async load() {
    return this.events;
  }

  async append(events) {
    const incoming = Array.isArray(events) ? events : [events];
    const known = new Set(this.events.map((e) => e.key));
    const additions = incoming
      .map((event) => ({ ...event, key: event.key || `${event.type}:${event.id}:${event.targetLedger}` }))
      .filter((event) => {
        if (known.has(event.key)) return false;
        known.add(event.key);
        return true;
      });
    if (!additions.length) return this.events;
    this.events = [...this.events, ...additions].slice(-this.maxEvents);
    return this.events;
  }

  async list(limit = 50) {
    return this.events.slice(-limit).reverse();
  }
}

/**
 * Stubbed production Postgres EventStore driver.
 * Recommended table schema:
 * CREATE TABLE events (
 *   key VARCHAR(255) PRIMARY KEY,
 *   type VARCHAR(64) NOT NULL,
 *   event_id INT NOT NULL,
 *   target_ledger INT NOT NULL,
 *   remaining_ledgers INT,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
 * );
 */
export class PostgresEventStore extends BaseEventStore {
  constructor(options = {}) {
    super();
    this.options = options;
    this.fallback = new InMemoryEventStore();
  }

  async load() {
    return this.fallback.load();
  }

  async append(events) {
    return this.fallback.append(events);
  }

  async list(limit = 50) {
    return this.fallback.list(limit);
  }
}

/**
 * Stubbed production SQLite EventStore driver.
 */
export class SQLiteEventStore extends BaseEventStore {
  constructor(options = {}) {
    super();
    this.options = options;
    this.fallback = new InMemoryEventStore();
  }

  async load() {
    return this.fallback.load();
  }

  async append(events) {
    return this.fallback.append(events);
  }

  async list(limit = 50) {
    return this.fallback.list(limit);
  }
}

/**
 * Driver registry factory.
 */
export function createEventStore(driver = process.env.EVENT_STORE_DRIVER || 'file', options = {}) {
  switch (driver.toLowerCase()) {
    case 'memory':
    case 'inmemory':
      return new InMemoryEventStore(options.maxEvents);
    case 'postgres':
    case 'pg':
      return new PostgresEventStore(options);
    case 'sqlite':
      return new SQLiteEventStore(options);
    case 'file':
    default:
      return new FileEventStore(options.filePath, options.maxEvents, options.log);
  }
}
