export const config = {
  keeperSecret: process.env.KEEPER_SECRET || '',
  vaultContractId: process.env.VAULT_CONTRACT_ID || '',
  streamContractId: process.env.STREAM_CONTRACT_ID || '',
  dcaContractId: process.env.DCA_CONTRACT_ID || '',
  coordinatorContractId: process.env.COORDINATOR_CONTRACT_ID || '',
  coordinatorLockTtlLedgers: parseInt(process.env.COORDINATOR_LOCK_TTL_LEDGERS || '20', 10),
  rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
  port: parseInt(process.env.PORT || '3002', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  retryMaxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '5', 10),
  retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
};

/**
 * Validates the loaded config at startup and fails fast with a clear error
 * listing every problem, instead of the keeper crashing later deep inside a
 * watcher/RPC call with a confusing error (#101).
 */
export function validateConfig(cfg = config) {
  const errors = [];

  if (!cfg.keeperSecret) errors.push('KEEPER_SECRET is required');
  if (!cfg.vaultContractId && !cfg.streamContractId && !cfg.dcaContractId) {
    errors.push(
      'At least one of VAULT_CONTRACT_ID, STREAM_CONTRACT_ID, DCA_CONTRACT_ID must be set'
    );
  }
  try {
    new URL(cfg.rpcUrl);
  } catch {
    errors.push(`STELLAR_RPC_URL is not a valid URL: "${cfg.rpcUrl}"`);
  }
  if (!Number.isFinite(cfg.pollIntervalMs) || cfg.pollIntervalMs <= 0) {
    errors.push('POLL_INTERVAL_MS must be a positive number');
  }
  if (!Number.isFinite(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
    errors.push('PORT must be a valid port number (1-65535)');
  }
  if (!Number.isFinite(cfg.retryMaxAttempts) || cfg.retryMaxAttempts < 0) {
    errors.push('RETRY_MAX_ATTEMPTS must be a non-negative number');
  }
  if (!Number.isFinite(cfg.retryBaseDelayMs) || cfg.retryBaseDelayMs < 0) {
    errors.push('RETRY_BASE_DELAY_MS must be a non-negative number');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid keeper configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}
