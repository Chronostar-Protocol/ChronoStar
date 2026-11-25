#!/usr/bin/env node

/**
 * Event-store backup and restore utility with SHA-256 verification.
 */

import { FileEventStore } from '../src/store.js';
import { resolve } from 'node:path';

const [action, targetPath] = process.argv.slice(2);

async function main() {
  const store = new FileEventStore();

  if (action === 'backup') {
    const destination = resolve(targetPath || `data/events-backup-${Date.now()}.json`);
    console.log(`Backing up event store to ${destination}...`);
    const res = await store.backup(destination);
    console.log(`Backup completed: ${res.count} events saved.`);
    console.log(`SHA-256: ${res.checksum}`);
    process.exit(0);
  } else if (action === 'restore') {
    if (!targetPath) {
      console.error('Usage: node scripts/event-store-backup.js restore <backupPath>');
      process.exit(1);
    }
    const source = resolve(targetPath);
    console.log(`Restoring event store from ${source}...`);
    const res = await store.restore(source);
    console.log(`Restore completed: ${res.restoredCount} events restored.`);
    console.log(`Verified SHA-256: ${res.checksum}`);
    process.exit(0);
  } else {
    console.error('Usage: node scripts/event-store-backup.js [backup|restore] [path]');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Operation failed:', err);
  process.exit(1);
});
