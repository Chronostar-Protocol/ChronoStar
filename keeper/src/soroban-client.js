import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Memo,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  FeeBudgetController,
  PerTxFeeLimitExceededError,
  DailyFeeBudgetExhaustedError,
} from "./fee-budget.js";
import { TransactionJournal } from "./journal.js";

const DUMMY_ACCOUNT_ID = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export class LedgerStalledError extends Error {
  constructor(status) {
    super(`observed ledger ${status.observedLedger} has not advanced for ${status.stallDurationMs}ms`);
    this.name = "LedgerStalledError";
    this.observedLedger = status.observedLedger;
    this.stallDurationMs = status.stallDurationMs;
  }
}

export class NetworkIdentityMismatchError extends Error {
  constructor(expected, actual, rpcUrl) {
    super(`RPC network passphrase mismatch: expected "${expected}" but RPC at "${rpcUrl}" reported "${actual}"`);
    this.name = "NetworkIdentityMismatchError";
    this.expected = expected;
    this.actual = actual;
    this.rpcUrl = rpcUrl;
  }
}

export { PerTxFeeLimitExceededError, DailyFeeBudgetExhaustedError };

export class SorobanClient {
  constructor({
    now = Date.now,
    feeBudget,
    journal,
  } = {}) {
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
    this.sourceKeypair = config.keeperSecret ? Keypair.fromSecret(config.keeperSecret) : null;
    this.sourceAccount = null;
    this.now = now;
    this.observedLedger = null;
    this.lastLedgerAdvanceAt = null;
    this.ledgerStalled = false;
    this.stalledAtLedger = null;
    this.lastTransportError = null;
    this.networkVerified = false;

    this.feeBudget = feeBudget || new FeeBudgetController({
      statePath: config.feeStatePath,
      maxFeeStroops: config.maxFeeStroops,
      dailyBudgetStroops: config.dailyFeeBudgetStroops,
      now,
    });

    this.journal = journal || new TransactionJournal({
      journalPath: config.journalPath,
      maxEntries: config.journalMaxEntries,
      now,
    });
  }

  async init() {
    if (this.sourceKeypair) {
      this.sourceAccount = await this.server.getAccount(this.sourceKeypair.publicKey());
    }
  }

  async verifyNetworkIdentity() {
    let lastErr;
    for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
      try {
        const net = await this.server.getNetwork();
        const actualPassphrase = net?.passphrase;
        if (actualPassphrase !== config.networkPassphrase) {
          const err = new NetworkIdentityMismatchError(
            config.networkPassphrase,
            actualPassphrase,
            config.rpcUrl,
          );
          logger.fatal(
            { expected: config.networkPassphrase, actual: actualPassphrase, rpcUrl: config.rpcUrl },
            "RPC network passphrase mismatch; halting keeper"
          );
          throw err;
        }
        this.networkVerified = true;
        logger.info(
          { networkPassphrase: actualPassphrase, protocolVersion: net?.protocolVersion },
          "Verified RPC network identity successfully"
        );
        return net;
      } catch (err) {
        if (err instanceof NetworkIdentityMismatchError) {
          throw err;
        }
        lastErr = err;
        logger.warn(
          { attempt, err: err.message, rpcUrl: config.rpcUrl },
          "Failed to verify network identity; retrying"
        );
        if (attempt < config.retryMaxAttempts) {
          await sleep(config.retryBaseDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }
    throw lastErr;
  }

  async reconcileJournal() {
    return this.journal.reconcile(this.server);
  }

  feeBudgetStatus() {
    return this.feeBudget.status();
  }

  _account() {
    return this.sourceAccount || new Account(DUMMY_ACCOUNT_ID, "0");
  }

  _buildTx(contractId, method, args, feeAccount, correlationId) {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);
    const builder = new TransactionBuilder(feeAccount || this._account(), {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30);

    if (correlationId) {
      const memoStr = String(correlationId).replace(/-/g, "").slice(0, 28);
      builder.addMemo(Memo.text(memoStr));
    }

    return builder.build();
  }

  _assemble(tx, simulation) {
    return rpc.assembleTransaction(tx, simulation).build();
  }

  async readContract(contractId, method, args) {
    const tx = this._buildTx(contractId, method, args);
    const sim = await this._simulateTransaction(tx);
    if (sim.error || !rpc.Api.isSimulationSuccess(sim)) {
      throw new Error(`simulate ${method} failed: ${sim.error ?? sim.result?.error ?? "unknown"}`);
    }
    this._observeLedger(sim.latestLedger);
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

  /** Claims execution lock on a resource for coordination (#437) */
  async claimExecution(resource, id, ttlLedgers = 10) {
    if (!config.coordinatorContractId) return true;
    if (!this.sourceKeypair) return true;
    try {
      const args = [
        nativeToScVal(resource, { type: "symbol" }),
        nativeToScVal(BigInt(id), { type: "u64" }),
        this._keeperArg(),
        nativeToScVal(ttlLedgers, { type: "u32" }),
      ];

      // Simulate first to avoid spending fee if lock is taken
      const tx = this._buildTx(config.coordinatorContractId, "claim", args, this.sourceAccount);
      const sim = await this._simulateTransaction(tx);
      if (sim.error || !rpc.Api.isSimulationSuccess(sim)) {
        return false;
      }
      if (sim.result?.retval && scValToNative(sim.result.retval) === false) {
        return false;
      }
      const res = await this.invokeContract(config.coordinatorContractId, "claim", args);
      return res?.status === "SUCCESS" || res?.status === "PENDING";
    } catch (err) {
      logger.warn({ err: err.message, resource, id }, "claimExecution failed");
      return false;
    }
  }

  /** Releases execution lock on a resource for coordination (#437) */
  async releaseExecution(resource, id) {
    if (!config.coordinatorContractId) return true;
    if (!this.sourceKeypair) return true;
    try {
      const args = [
        nativeToScVal(resource, { type: "symbol" }),
        nativeToScVal(BigInt(id), { type: "u64" }),
        this._keeperArg(),
      ];
      await this.invokeContract(config.coordinatorContractId, "release", args);
      return true;
    } catch (err) {
      logger.warn({ err: err.message, resource, id }, "releaseExecution failed");
      return false;
    }
  }

  async invokeContract(contractId, method, args, correlationId) {
    if (!this.sourceAccount || !this.sourceKeypair) {
      throw new Error("keeper secret required to invoke contract calls");
    }

    let lastError;
    for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
      try {
        this._assertLedgerCanSubmit();
        const tx = this._buildTx(contractId, method, args, this.sourceAccount, correlationId);

        const simulation = await this._simulateTransaction(tx);
        if (simulation.error || !rpc.Api.isSimulationSuccess(simulation)) {
          throw new Error(
            `${method} simulation failed: ${simulation.error ?? simulation.result?.error ?? "unknown"}`,
          );
        }
        this._observeLedger(simulation.latestLedger);
        this._assertLedgerCanSubmit();

        const prepared = this._assemble(tx, simulation);
        const feeStroops = Number(prepared.fee) || 0;

        // Check fee budget limits before signing (#436)
        this.feeBudget.checkAndReserve(feeStroops);
        let txSubmitted = false;
        let txHash = null;

        try {
          prepared.sign(this.sourceKeypair);
          const submitResponse = await this.server.sendTransaction(prepared);
          txHash = submitResponse.hash;
          txSubmitted = true;

          // Record in execution journal (#435)
          this.journal.recordSubmission({
            actionKey: `${contractId}:${method}`,
            contractId,
            method,
            txHash,
            correlationId,
            feeStroops,
          });

          logger.info(
            { correlationId, txHash, method, contractId, status: submitResponse.status },
            "contract invocation submitted",
          );

          if (submitResponse.status === "ERROR") {
            this.feeBudget.release(feeStroops);
            this.journal.recordSettlement({
              txHash,
              correlationId,
              status: "FAILED",
              error: submitResponse.errorResultXdr || submitResponse.status,
            });
            throw new Error(
              `sendTransaction error: ${submitResponse.errorResultXdr || submitResponse.status}`,
            );
          }

          if (submitResponse.status === "PENDING" || submitResponse.status === "DUPLICATE") {
            const receipt = await this.server.getTransaction(txHash);
            const settledSuccess = receipt.status === "SUCCESS";
            this.feeBudget.confirm(feeStroops);
            this.journal.recordSettlement({
              txHash,
              correlationId,
              status: settledSuccess ? "SUCCESS" : "FAILED",
              error: settledSuccess ? null : receipt.errorResultXdr || "Transaction execution failed",
            });
            logger.info(
              { correlationId, txHash, method, contractId, status: receipt.status },
              "contract transaction settled",
            );
            return { ...receipt, hash: txHash, correlationId };
          }

          this.feeBudget.confirm(feeStroops);
          this.journal.recordSettlement({
            txHash,
            correlationId,
            status: "SUCCESS",
          });
          return { ...submitResponse, hash: txHash, correlationId };
        } catch (innerErr) {
          if (!txSubmitted) {
            this.feeBudget.release(feeStroops);
          }
          throw innerErr;
        }
      } catch (err) {
        if (
          err instanceof LedgerStalledError ||
          err instanceof PerTxFeeLimitExceededError ||
          err instanceof DailyFeeBudgetExhaustedError
        ) {
          throw err;
        }
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

  ledgerStatus() {
    const hasObservedLedger = this.observedLedger !== null;
    const stallDurationMs = hasObservedLedger
      ? Math.max(0, this.now() - this.lastLedgerAdvanceAt)
      : null;
    const stalled = !this.lastTransportError && hasObservedLedger && stallDurationMs >= config.maxLedgerStallMs;

    if (stalled && !this.ledgerStalled) {
      this.ledgerStalled = true;
      this.stalledAtLedger = this.observedLedger;
      logger.error(
        { observedLedger: this.observedLedger, stallDurationMs, maxLedgerStallMs: config.maxLedgerStallMs },
        "observed ledger stalled; suspending submissions",
      );
    } else if (
      this.ledgerStalled &&
      this.observedLedger > this.stalledAtLedger
    ) {
      this.ledgerStalled = false;
      this.stalledAtLedger = null;
      logger.info(
        { observedLedger: this.observedLedger },
        "observed ledger advanced; resuming submissions",
      );
    }

    return {
      status: this.lastTransportError
        ? "transport_error"
        : !hasObservedLedger
          ? "unknown"
          : stalled
            ? "stalled"
            : "healthy",
      stalled,
      observedLedger: this.observedLedger,
      lastAdvancedAt: this.lastLedgerAdvanceAt,
      stallDurationMs,
      maxStallDurationMs: config.maxLedgerStallMs,
      transportError: this.lastTransportError,
    };
  }

  async _simulateTransaction(tx) {
    try {
      const simulation = await this.server.simulateTransaction(tx);
      this.lastTransportError = null;
      return simulation;
    } catch (err) {
      this.lastTransportError = { message: err.message, occurredAt: this.now() };
      throw err;
    }
  }

  _observeLedger(ledger) {
    const observed = Number(ledger);
    if (!Number.isSafeInteger(observed) || observed < 0) return;
    if (this.observedLedger === null || observed > this.observedLedger) {
      this.observedLedger = observed;
      this.lastLedgerAdvanceAt = this.now();
    }
    this.ledgerStatus();
  }

  _assertLedgerCanSubmit() {
    const status = this.ledgerStatus();
    if (status.stalled) throw new LedgerStalledError(status);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
