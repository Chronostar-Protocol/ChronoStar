import { StrKey } from '@stellar/stellar-sdk';

export const config = {
  vaultContractId: process.env.VAULT_CONTRACT_ID || '',
  streamContractId: process.env.STREAM_CONTRACT_ID || '',
  dcaContractId: process.env.DCA_CONTRACT_ID || '',
  rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  port: parseInt(process.env.PORT || '3001', 10),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || '',
  maxSseConnections: parseInt(process.env.MAX_SSE_CONNECTIONS || '100', 10),
  maxSsePerIp: parseInt(process.env.MAX_SSE_PER_IP || '10', 10),
};

const CONTRACT_ID_VARS = [
  ['vaultContractId', 'VAULT_CONTRACT_ID'],
  ['streamContractId', 'STREAM_CONTRACT_ID'],
  ['dcaContractId', 'DCA_CONTRACT_ID'],
];

/**
 * Returns every problem with a configuration, as human-readable strings
 * (empty when valid). Messages name the setting and never echo its value.
 */
export function getConfigProblems(cfg = config) {
  const problems = [];

  const anyContract = CONTRACT_ID_VARS.some(([key]) => cfg[key]);
  if (!anyContract) {
    problems.push('At least one of VAULT_CONTRACT_ID, STREAM_CONTRACT_ID, DCA_CONTRACT_ID must be set');
  }
  for (const [key, envName] of CONTRACT_ID_VARS) {
    if (cfg[key] && !StrKey.isValidContract(cfg[key])) {
      problems.push(`${envName} is not a valid Stellar contract address`);
    }
  }

  try {
    const url = new URL(cfg.rpcUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      problems.push('STELLAR_RPC_URL must use http or https');
    }
  } catch {
    problems.push('STELLAR_RPC_URL is not a valid URL');
  }

  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    problems.push('PORT must be a whole number between 1 and 65535');
  }

  if (!cfg.networkPassphrase) {
    problems.push('STELLAR_NETWORK_PASSPHRASE must not be empty');
  }

  if (!Number.isInteger(cfg.maxSseConnections) || cfg.maxSseConnections < 1) {
    problems.push('MAX_SSE_CONNECTIONS must be a whole number greater than 0');
  }

  if (!Number.isInteger(cfg.maxSsePerIp) || cfg.maxSsePerIp < 1) {
    problems.push('MAX_SSE_PER_IP must be a whole number greater than 0');
  }

  return problems;
}

/** Throws one error listing every configuration problem, or returns when valid. */
export function validateConfig(cfg = config) {
  const problems = getConfigProblems(cfg);
  if (problems.length > 0) {
    throw new Error(
      `Invalid backend configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

function parseTrustProxy(value) {
  if (value === undefined || value === '') {
    return process.env.NODE_ENV === 'production' ? 1 : false;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : value;
}
