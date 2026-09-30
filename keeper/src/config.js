export const config = {
  keeperSecret: process.env.KEEPER_SECRET || '',
  vaultContractId: process.env.VAULT_CONTRACT_ID || '',
  streamContractId: process.env.STREAM_CONTRACT_ID || '',
  dcaContractId: process.env.DCA_CONTRACT_ID || '',
  rpcUrls: (process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org').split(',').map((url) => url.trim()).filter(Boolean),
  get rpcUrl() { return this.rpcUrls[0]; },
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
  port: parseInt(process.env.PORT || '3002', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  retryMaxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '5', 10),
  retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
};
