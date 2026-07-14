import { rpc, Contract } from '@stellar/stellar-sdk';
import { config } from './config.js';
import { logger } from './logger.js';

export class SorobanClient {
  constructor() {
    this.server = new rpc.Server(config.rpcUrl);
    this.sourceAccount = null;
  }

  async init() {
    if (config.keeperSecret) {
      const { Keypair } = await import('@stellar/stellar-sdk');
      const kp = Keypair.fromSecret(config.keeperSecret);
      this.sourceAccount = await this.server.getAccount(kp.publicKey());
      this.sourceKeypair = kp;
    }
  }

  async invokeContract(contractId, method, args) {
    let lastError;
    for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
      try {
        const contract = new Contract(contractId);
        const fn = contract.call(method, ...args);

        const simulation = await this.server.simulateTransaction(fn);
        if (!this.sourceAccount) {
          return simulation.result;
        }

        const prepared = rpc.assembleTransaction(fn, config.networkPassphrase, simulation);
        prepared.sign(this.sourceKeypair);
        const tx = prepared.build();

        const submitResponse = await this.server.sendTransaction(tx);
        if (submitResponse.status === 'PENDING' || submitResponse.status === 'DUPLICATE') {
          const receipt = await this.server.getTransaction(submitResponse.hash);
          return receipt;
        }
        return submitResponse;
      } catch (err) {
        lastError = err;
        logger.warn({ attempt, method, err: err.message }, 'contract invocation failed');
        if (attempt < config.retryMaxAttempts) {
          const delay = config.retryBaseDelayMs * Math.pow(2, attempt - 1);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }

  async simulateContract(contractId, method, args) {
    const contract = new Contract(contractId);
    const fn = contract.call(method, ...args);
    const simulation = await this.server.simulateTransaction(fn);
    return simulation;
  }

  async readContract(contractId, method, args) {
    const simulation = await this.simulateContract(contractId, method, args);
    return simulation?.result?.retval;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
