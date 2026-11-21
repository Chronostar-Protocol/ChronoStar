import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_PATH = resolve(process.env.EVENT_STORE_PATH || 'data/events.json');

/**
 * Corruption error thrown when persisted event file is not valid JSON.
 */
export class EventStoreCorruptionError extends Error {
  constructor(message, filePath, cause) {
    super(message);
    this.name = 'EventStoreCorruptionError';
    this.code = 'ERR_EVENT_STORE_CORRUPT_JSON';
    this.filePath = filePath;
    this.cause = cause;
  }
}

/**
 * Validation error thrown when persisted event records fail schema validation.
 */
export class EventStoreValidationError extends Error {
  constructor(message, filePath, index = null, field = null) {
    super(message);
    this.name = 'EventStoreValidationError';
    this.code = 'ERR_EVENT_STORE_INVALID_RECORD';
    this.filePath = filePath;
    this.index = index;
    this.field = field;
  }
}

/**
 * Validate that an event record matches expected structure.
 */
export function validateEventRecord(record, index, filePath) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new EventStoreValidationError(
      `Invalid event record at index ${index} in "${filePath}": record must be an object`,
      filePath,
      index,
      'record'
    );
  }
  if (!record.type || typeof record.type !== 'string' || !record.type.trim()) {
    throw new EventStoreValidationError(
      `Invalid event record at index ${index} in "${filePath}": missing or invalid field 'type'`,
      filePath,
      index,
      'type'
    );
  }
  if (
    record.id === undefined ||
    record.id === null ||
    (typeof record.id !== 'string' && typeof record.id !== 'number' && typeof record.id !== 'bigint')
  ) {
    throw new EventStoreValidationError(
      `Invalid event record at index ${index} in "${filePath}": missing or invalid field 'id'`,
      filePath,
      index,
      'id'
    );
  }
  if (
    record.targetLedger === undefined ||
    record.targetLedger === null ||
    (typeof record.targetLedger !== 'number' && typeof record.targetLedger !== 'string') ||
    (typeof record.targetLedger === 'number' && (!Number.isFinite(record.targetLedger) || record.targetLedger <= 0))
  ) {
    throw new EventStoreValidationError(
      `Invalid event record at index ${index} in "${filePath}": missing or invalid field 'targetLedger'`,
      filePath,
      index,
      'targetLedger'
    );
  }
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

  async load() {
    if (this.events) return this.events;
    let contents;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.events = [];
        return this.events;
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      throw new EventStoreCorruptionError(
        `Malformed JSON in "${this.filePath}": ${error.message}`,
        this.filePath,
        error
      );
    }

    if (!Array.isArray(parsed)) {
      throw new EventStoreValidationError(
        `Invalid event store structure in "${this.filePath}": expected top-level array, received ${typeof parsed}`,
        this.filePath,
        null,
        'root'
      );
    }

    for (let i = 0; i < parsed.length; i++) {
      validateEventRecord(parsed[i], i, this.filePath);
    }

    this.events = parsed;
    return this.events;
  }

  async append(events) {
    const incoming = Array.isArray(events) ? events : [events];
    const current = await this.load();
    const known = new Set(current.map((event) => event.key));
    const additions = incoming
      .map((event) => ({ ...event, key: event.key || `${event.type}:${event.id}:${event.targetLedger}` }))
      .filter((event) => {
        if (known.has(event.key)) return false;
        known.add(event.key);
        return true;
      });
    if (!additions.length) return current;
    this.events = [...current, ...additions].slice(-this.maxEvents);
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(this.events, null, 2));
      await rename(temporaryPath, this.filePath);
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
