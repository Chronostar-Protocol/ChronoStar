import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export class TransactionJournal {
  constructor({
    journalPath = '.keeper-journal.json',
    maxEntries = 500,
    now = Date.now,
  } = {}) {
    this.journalPath = journalPath;
    this.maxEntries = Number(maxEntries) || 500;
    this.now = now;
    this.entries = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.journalPath)) {
        const raw = fs.readFileSync(this.journalPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
        } else if (Array.isArray(parsed.entries)) {
          this.entries = parsed.entries;
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to load transaction journal from disk; starting with empty journal');
      this.entries = [];
    }
  }

  _save() {
    try {
      this._prune();
      const dir = path.dirname(this.journalPath);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.journalPath,
        JSON.stringify({ entries: this.entries, updatedAt: new Date(this.now()).toISOString() }, null, 2),
        'utf8'
      );
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to persist transaction journal to disk');
    }
  }

  _prune() {
    if (this.entries.length <= this.maxEntries) return;

    // Prune settled entries first, oldest to newest
    const pending = [];
    const settled = [];

    for (const entry of this.entries) {
      if (entry.status === 'PENDING') {
        pending.push(entry);
      } else {
        settled.push(entry);
      }
    }

    const allowedSettled = Math.max(0, this.maxEntries - pending.length);
    const retainedSettled = settled.slice(settled.length - allowedSettled);

    this.entries = [...retainedSettled, ...pending];

    // If pending alone exceeds maxEntries, keep newest pending
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
  }

  recordSubmission({
    actionKey,
    contractId,
    method,
    txHash,
    correlationId,
    feeStroops = 0,
  }) {
    const entry = {
      id: correlationId || txHash || `${contractId}-${method}-${this.now()}`,
      actionKey: actionKey || `${contractId}:${method}`,
      contractId,
      method,
      txHash,
      correlationId: correlationId || null,
      feeStroops: Number(feeStroops) || 0,
      status: 'PENDING',
      submittedAt: new Date(this.now()).toISOString(),
      settledAt: null,
      error: null,
    };

    // Replace if existing by txHash or correlationId, otherwise append
    const existingIndex = this.entries.findIndex(
      (e) => (txHash && e.txHash === txHash) || (correlationId && e.correlationId === correlationId)
    );

    if (existingIndex >= 0) {
      this.entries[existingIndex] = { ...this.entries[existingIndex], ...entry };
    } else {
      this.entries.push(entry);
    }

    this._save();
    return entry;
  }

  recordSettlement({ txHash, correlationId, status = 'SUCCESS', error = null }) {
    const entry = this.entries.find(
      (e) => (txHash && e.txHash === txHash) || (correlationId && e.correlationId === correlationId)
    );

    if (entry) {
      entry.status = status;
      entry.settledAt = new Date(this.now()).toISOString();
      entry.error = error;
      this._save();
      return entry;
    }

    // If not found, add settled entry
    const fallbackEntry = {
      id: correlationId || txHash || `settled-${this.now()}`,
      actionKey: 'unknown',
      txHash: txHash || null,
      correlationId: correlationId || null,
      status,
      submittedAt: new Date(this.now()).toISOString(),
      settledAt: new Date(this.now()).toISOString(),
      error,
    };
    this.entries.push(fallbackEntry);
    this._save();
    return fallbackEntry;
  }

  getPendingEntries() {
    return this.entries.filter((e) => e.status === 'PENDING');
  }

  getEntries() {
    return [...this.entries];
  }

  async reconcile(server) {
    const pending = this.getPendingEntries();
    if (pending.length === 0) {
      return { reconciled: 0, pending: 0 };
    }

    logger.info({ pendingCount: pending.length }, 'Reconciling pending transactions from journal after restart');
    let reconciledCount = 0;

    for (const entry of pending) {
      if (!entry.txHash) {
        entry.status = 'FAILED';
        entry.error = 'Transaction hash missing from pending journal entry';
        entry.settledAt = new Date(this.now()).toISOString();
        reconciledCount++;
        continue;
      }

      try {
        const tx = await server.getTransaction(entry.txHash);
        if (tx && tx.status) {
          if (tx.status === 'SUCCESS') {
            entry.status = 'SUCCESS';
            entry.settledAt = new Date(this.now()).toISOString();
            reconciledCount++;
            logger.info({ txHash: entry.txHash, actionKey: entry.actionKey }, 'Reconciled pending transaction as SUCCESS');
          } else if (tx.status === 'FAILED' || tx.status === 'ERROR') {
            entry.status = 'FAILED';
            entry.error = tx.errorResultXdr || 'Transaction failed on-chain';
            entry.settledAt = new Date(this.now()).toISOString();
            reconciledCount++;
            logger.warn({ txHash: entry.txHash, actionKey: entry.actionKey }, 'Reconciled pending transaction as FAILED');
          }
          // If still PENDING or NOT_FOUND, leave as is or check expiry
        }
      } catch (err) {
        logger.warn(
          { txHash: entry.txHash, err: err.message },
          'Error checking transaction status during journal reconciliation'
        );
      }
    }

    this._save();
    return {
      reconciled: reconciledCount,
      pending: this.getPendingEntries().length,
    };
  }
}
