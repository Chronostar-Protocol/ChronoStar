import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_PATH = resolve(process.env.EVENT_STORE_PATH || 'data/events.json');

export class EventStore {
  constructor(filePath = DEFAULT_PATH, maxEvents = 10_000) {
    this.filePath = filePath;
    this.maxEvents = maxEvents;
    this.events = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.events) return this.events;
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(contents);
      this.events = Array.isArray(parsed) ? parsed : [];
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
      .filter((event) => !known.has(event.key));
    if (!additions.length) return current;
    this.events = [...current, ...additions].slice(-this.maxEvents);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(this.events, null, 2));
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
    return this.events;
  }

  async list(limit = 50) {
    const events = await this.load();
    return events.slice(-limit).reverse();
  }
}
