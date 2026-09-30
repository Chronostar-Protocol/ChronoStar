import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('config', () => {
  it('loads default values when env vars are missing', async () => {
    const { config } = await import('./config.js');
    assert.equal(config.rpcUrl, 'https://soroban-testnet.stellar.org');
    assert.equal(config.networkPassphrase, 'Test SDF Network ; September 2015');
    assert.equal(config.pollIntervalMs, 30000);
    assert.equal(config.port, 3002);
    assert.equal(config.logLevel, 'info');
    assert.equal(config.retryMaxAttempts, 5);
    assert.equal(config.retryBaseDelayMs, 1000);
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
          port: 3002,
          retryMaxAttempts: 5,
          retryBaseDelayMs: 1000,
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
        port: 3002,
        retryMaxAttempts: 5,
        retryBaseDelayMs: 1000,
      })
    );
  });
});
