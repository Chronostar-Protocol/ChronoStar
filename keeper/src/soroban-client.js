import { Account, BASE_FEE, Contract, Keypair, Memo, TransactionBuilder, rpc, scValToNative } from '@stellar/stellar-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { RpcEndpointPool } from './rpc-endpoint-pool.js';

const DUMMY_ACCOUNT_ID = 'GCTUWZIHE7I2AGP7K3DFGBTGZQR6QQJJAKRELHQJPG3MNR6MOKRQNVL2';

export class SorobanClient {
  constructor({ rpcUrls = config.rpcUrls, createServer = (url) => new rpc.Server(url) } = {}) {
    this.rpcPool = new RpcEndpointPool(rpcUrls, createServer);
    this.server = new Proxy({}, { get: (_target, method) => (...args) => this.rpcPool.call(method, ...args) });
    this.sourceAccount = null;
    this.sourceKeypair = null;
  }

  getRpcMetrics() { return this.rpcPool.metrics(); }

  async init() {
    if (config.keeperSecret) {
      const kp = Keypair.fromSecret(config.keeperSecret);
      this.sourceAccount = await this.server.getAccount(kp.publicKey());
      this.sourceKeypair = kp;
    }
  }

  _account() { return this.sourceAccount || new Account(DUMMY_ACCOUNT_ID, '0'); }

  _buildTx(contractId, method, args, feeAccount, correlationId) {
    const op = new Contract(contractId).call(method, ...args);
    const builder = new TransactionBuilder(feeAccount || this._account(), {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    }).addOperation(op).setTimeout(30);
    if (correlationId) builder.addMemo(Memo.text(String(correlationId).replace(/-/g, '').slice(0, 28)));
    return builder.build();
  }

  async readContract(contractId, method, args) {
    const sim = await this.server.simulateTransaction(this._buildTx(contractId, method, args));
    if (sim.error || !rpc.Api.isSimulationSuccess(sim)) {
      throw new Error(`simulate ${method} failed: ${sim.error ?? sim.result?.error ?? 'unknown'}`);
    }
    return sim?.result?.retval === undefined ? undefined : scValToNative(sim.result.retval);
  }

  async refreshAccount() {
    if (this.sourceKeypair) this.sourceAccount = await this.server.getAccount(this.sourceKeypair.publicKey());
  }

  async invokeContract(contractId, method, args, correlationId) {
    if (!this.sourceAccount || !this.sourceKeypair) throw new Error('keeper secret required to invoke contract calls');
    let lastError;
    for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
      try {
        const tx = this._buildTx(contractId, method, args, this.sourceAccount, correlationId);
        const simulation = await this.server.simulateTransaction(tx);
        if (simulation.error || !rpc.Api.isSimulationSuccess(simulation)) {
          throw new Error(`${method} simulation failed: ${simulation.error ?? simulation.result?.error ?? 'unknown'}`);
        }
        const prepared = rpc.assembleTransaction(tx, simulation).build();
        prepared.sign(this.sourceKeypair);
        const submitted = await this.server.sendTransaction(prepared);
        if (submitted.status === 'ERROR') throw new Error(`sendTransaction error: ${submitted.errorResultXdr || submitted.status}`);
        const txHash = submitted.hash;
        logger.info({ correlationId, txHash, method, contractId, status: submitted.status }, 'contract invocation submitted');
        if (submitted.status === 'PENDING' || submitted.status === 'DUPLICATE') {
          const receipt = await this.server.getTransaction(txHash);
          return { ...receipt, hash: txHash, correlationId };
        }
        return { ...submitted, hash: txHash, correlationId };
      } catch (err) {
        lastError = err;
        logger.warn({ attempt, method, correlationId, err: err.message }, 'contract invocation failed');
        try { await this.refreshAccount(); } catch (refreshErr) {
          logger.warn({ err: refreshErr.message }, 'failed to refresh source account sequence');
        }
        if (attempt < config.retryMaxAttempts) await sleep(config.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
