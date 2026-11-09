import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";

const DUMMY_ACCOUNT_ID = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export class SorobanClient {
  constructor() {
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
    this.sourceKeypair = config.keeperSecret ? Keypair.fromSecret(config.keeperSecret) : null;
    this.sourceAccount = null;
  }

  async init() {
    if (this.sourceKeypair) {
      this.sourceAccount = await this.server.getAccount(this.sourceKeypair.publicKey());
    }
  }

  _account() {
    return this.sourceAccount || new Account(DUMMY_ACCOUNT_ID, "0");
  }

  _buildTx(contractId, method, args = [], feeAccount, _correlationId) {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);
    const builder = new TransactionBuilder(feeAccount || this._account(), {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30);

    return builder.build();
  }

  _assemble(tx, simulation) {
    return rpc.assembleTransaction(tx, simulation).build();
  }

  async readContract(contractId, method, args = []) {
    const tx = this._buildTx(contractId, method, args);
    const sim = await this.server.simulateTransaction(tx);
    if (sim.error || !rpc.Api.isSimulationSuccess(sim)) {
      throw new Error(`simulate ${method} failed: ${sim.error ?? sim.result?.error ?? "unknown"}`);
    }
    const retval = sim?.result?.retval;
    if (retval === undefined) return undefined;
    return scValToNative(retval);
  }

  async refreshAccount() {
    if (this.sourceKeypair) {
      this.sourceAccount = await this.server.getAccount(this.sourceKeypair.publicKey());
    }
  }

  /** Public key of the keeper account, or null when no secret is configured. */
  keeperAddress() {
    return this.sourceKeypair ? this.sourceKeypair.publicKey() : null;
  }

  _keeperArg() {
    const address = this.keeperAddress();
    if (!address) throw new Error("keeper secret required to register with the coordinator");
    return new Address(address).toScVal();
  }

  /** Whether this keeper is already registered with the coordinator. */
  async isRegistered(coordinatorId) {
    return Boolean(await this.readContract(coordinatorId, "is_registered", [this._keeperArg()]));
  }

  /** Registers this keeper with the coordinator (retried with backoff by invokeContract). */
  async register(coordinatorId, correlationId) {
    return this.invokeContract(coordinatorId, "register", [this._keeperArg()], correlationId);
  }

  /** Removes this keeper's registration from the coordinator. */
  async unregister(coordinatorId, correlationId) {
    return this.invokeContract(coordinatorId, "unregister", [this._keeperArg()], correlationId);
  }

  async invokeContract(contractId, method, args = [], correlationId) {
    if (!this.sourceAccount || !this.sourceKeypair) {
      throw new Error("keeper secret required to invoke contract calls");
    }

    let lastError;
    for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
      try {
        const tx = this._buildTx(contractId, method, args, this.sourceAccount, correlationId);

        const simulation = await this.server.simulateTransaction(tx);
        if (simulation.error || !rpc.Api.isSimulationSuccess(simulation)) {
          throw new Error(
            `${method} simulation failed: ${simulation.error ?? simulation.result?.error ?? "unknown"}`,
          );
        }

        const prepared = this._assemble(tx, simulation);
        prepared.sign(this.sourceKeypair);
        const submitResponse = await this.server.sendTransaction(prepared);
        const txHash = submitResponse.hash;

        logger.info(
          { correlationId, txHash, method, contractId, status: submitResponse.status },
          "contract invocation submitted",
        );

        if (submitResponse.status === "ERROR") {
          throw new Error(
            `sendTransaction error: ${submitResponse.errorResultXdr || submitResponse.status}`,
          );
        }

        if (submitResponse.status === "PENDING" || submitResponse.status === "DUPLICATE") {
          const receipt = await this.server.getTransaction(txHash);
          logger.info(
            { correlationId, txHash, method, contractId, status: receipt.status },
            "contract transaction settled",
          );
          if (receipt.status === "FAILED") {
            throw new Error(`getTransaction failed: ${receipt.resultXdr || receipt.status}`);
          }
          return { ...receipt, hash: txHash, correlationId };
        }
        return { ...submitResponse, hash: txHash, correlationId };
      } catch (err) {
        lastError = err;
        logger.warn(
          { attempt, method, correlationId, err: err.message },
          "contract invocation failed",
        );
        if (this.sourceKeypair) {
          try {
            await this.refreshAccount();
          } catch (refreshErr) {
            logger.warn({ err: refreshErr.message }, "failed to refresh source account sequence");
          }
        }
        if (attempt < config.retryMaxAttempts) {
          const delay = config.retryBaseDelayMs * Math.pow(2, attempt - 1);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
