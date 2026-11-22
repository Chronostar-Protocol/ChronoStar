import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('config', () => {
  it('loads default values when env vars are missing', async () => {
    const { config } = await import('./config.js');
    assert.equal(config.rpcUrl, 'https://soroban-testnet.stellar.org');
    assert.equal(config.networkPassphrase, 'Test SDF Network ; September 2015');
    assert.equal(config.pollIntervalMs, 30000);
    assert.equal(config.maxLedgerStallMs, 120000);
    assert.equal(config.port, 3002);
    assert.equal(config.logLevel, 'info');
    assert.equal(config.retryMaxAttempts, 5);
    assert.equal(config.retryBaseDelayMs, 1000);
    assert.equal(config.maxFeeStroops, 1000000);
    assert.equal(config.dailyFeeBudgetStroops, 50000000);
    assert.equal(config.journalMaxEntries, 500);
  });
});

describe('validateConfig', () => {
  it('throws with a listed reason when keeperSecret is missing', async () => {
    const { validateConfig } = await import('./config.js');
    assert.throws(
      () =>
        validateConfig({
          keeperSecret: '',
          vaultContractId: 'C123',
          rpcUrl: 'https://soroban-testnet.stellar.org',
          pollIntervalMs: 30000,
          maxLedgerStallMs: 120000,
          port: 3002,
          retryMaxAttempts: 5,
          retryBaseDelayMs: 1000,
          maxFeeStroops: 1000000,
          dailyFeeBudgetStroops: 50000000,
          journalMaxEntries: 500,
        }),
      /KEEPER_SECRET is required/
    );
  });

  it('passes for a fully valid config', async () => {
    const { validateConfig } = await import('./config.js');
    assert.doesNotThrow(() =>
      validateConfig({
        keeperSecret: 'S...',
        vaultContractId: 'C123',
        streamContractId: '',
        dcaContractId: '',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        pollIntervalMs: 30000,
        maxLedgerStallMs: 120000,
        port: 3002,
        retryMaxAttempts: 5,
        retryBaseDelayMs: 1000,
        maxFeeStroops: 1000000,
        dailyFeeBudgetStroops: 50000000,
        journalMaxEntries: 500,
      })
    );
  });

  it('requires a positive maximum ledger stall duration', async () => {
    const { validateConfig } = await import('./config.js');
    assert.throws(
      () => validateConfig({
        keeperSecret: 'S...',
        vaultContractId: 'C123',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        pollIntervalMs: 30000,
        maxLedgerStallMs: 0,
        port: 3002,
        retryMaxAttempts: 5,
        retryBaseDelayMs: 1000,
        maxFeeStroops: 1000000,
        dailyFeeBudgetStroops: 50000000,
        journalMaxEntries: 500,
      }),
      /MAX_LEDGER_STALL_MS must be a positive number/
    );
  });

  it('validates fee budget and journal configuration bounds (#436, #435)', async () => {
    const { validateConfig } = await import('./config.js');
    const valid = {
      keeperSecret: 'S...',
      vaultContractId: 'C123',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      pollIntervalMs: 30000,
      maxLedgerStallMs: 120000,
      port: 3002,
      retryMaxAttempts: 5,
      retryBaseDelayMs: 1000,
      maxFeeStroops: 1000000,
      dailyFeeBudgetStroops: 50000000,
      journalMaxEntries: 500,
    };

    assert.throws(
      () => validateConfig({ ...valid, maxFeeStroops: -1 }),
      /MAX_FEE_STROOPS must be a non-negative number/
    );
    assert.throws(
      () => validateConfig({ ...valid, dailyFeeBudgetStroops: -5 }),
      /DAILY_FEE_BUDGET_STROOPS must be a non-negative number/
    );
    assert.throws(
      () => validateConfig({ ...valid, journalMaxEntries: 0 }),
      /JOURNAL_MAX_ENTRIES must be a positive number/
    );
  });
});
