import {
  rpc,
  Contract,
  xdr,
  Address,
  Keypair,
  Account,
  MuxedAccount,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";

export class ContractSimulationError extends Error {
  constructor(diagnostic) {
    super(`Soroban simulation failed: ${diagnostic}`);
    this.name = "ContractSimulationError";
    this.statusCode = 502;
  }
}

export function serializeArgs(args) {
  if (!args) return "[]";
  return JSON.stringify(args, (_key, value) => {
    if (typeof value === "bigint") {
      return `${value.toString()}n`;
    }
    if (value && typeof value.toXDR === "function") {
      return `xdr:${value.toXDR("base64")}`;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof RegExp)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

export class SorobanClient {
  constructor(options = {}) {
    const rpcUrl = options.rpcUrl ?? config.rpcUrl;
    const isInsecureHttp = rpcUrl?.startsWith("http://");
    this.server = options.server ?? new rpc.Server(rpcUrl, { allowHttp: isInsecureHttp });
    this.networkPassphrase = options.networkPassphrase ?? config.networkPassphrase;
    this.inFlight = options.inFlight ?? new Map();
  }

  _getInFlightKey(contractId, method, args, options) {
    const network = options?.networkPassphrase ?? this.networkPassphrase ?? "";
    return `${network}:${contractId}:${method}:${serializeArgs(args)}`;
  }

  async simulate(contractId, method, args = [], options = {}) {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);
    const source = Keypair.random();
    const acc = new Account(source.publicKey(), "0");
    const networkPassphrase = options?.networkPassphrase ?? this.networkPassphrase;
    const tx = new TransactionBuilder(acc, {
      fee: null,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(0)
      .build();
    const simulation = await this.server.simulateTransaction(tx);
    return simulation;
  }

  readContract(contractId, method, args = [], options = {}) {
    const key = this._getInFlightKey(contractId, method, args, options);

    let entry = this.inFlight.get(key);

    if (!entry) {
      const promise = (async () => {
        try {
          const sim = await this.simulate(contractId, method, args, options);
          if (rpc.Api.isSimulationError(sim) || sim?.error) {
            const diagnostic =
              typeof sim?.error === "string"
                ? sim.error
                : sim?.error?.message || sim?.error?.toString?.() || "unknown RPC error";
            throw new ContractSimulationError(diagnostic);
          }
          if (!sim?.result?.retval) return null;
          return normalizeNative(scValToNative(sim.result.retval));
        } finally {
          this.inFlight.delete(key);
        }
      })();

      // Prevent unhandled rejections if all consumers cancel or detach early
      promise.catch(() => {});

      this.inFlight.set(key, promise);
      entry = promise;
    }

    if (options?.signal) {
      const { signal } = options;
      if (signal.aborted) {
        return Promise.reject(signal.reason ?? new Error("This operation was aborted"));
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          reject(signal.reason ?? new Error("This operation was aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.then(
          (val) => {
            signal.removeEventListener("abort", onAbort);
            resolve(val);
          },
          (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        );
      });
    }

    return entry;
  }

  scvU64(val) {
    return xdr.ScVal.scvU64(BigInt(val));
  }
  scvU32(val) {
    return xdr.ScVal.scvU32(Number(val));
  }
  /** Encodes a list of ids as a Soroban `Vec<u64>`. */
  scvVecU64(values) {
    return xdr.ScVal.scvVec(values.map((v) => xdr.ScVal.scvU64(BigInt(v))));
  }
  scvAddress(addr) {
    // Contracts only know account and contract addresses, so a muxed account
    // (M...) is looked up by the account it belongs to.
    const resolved = addr.startsWith("M")
      ? MuxedAccount.fromAddress(addr, "0").baseAccount().accountId()
      : addr;
    return Address.fromString(resolved).toScVal();
  }
}

function normalizeNative(value) {
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] === "string") {
      const ordinal = STATUS_ORDINALS[value[0]];
      if (ordinal !== undefined) return ordinal;
    }
    return value.map(normalizeNative);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, normalizeNative(val)]),
    );
  }
  return value;
}

const STATUS_ORDINALS = {
  Active: 0,
  Released: 1,
  Completed: 1,
  Exhausted: 1,
  Cancelled: 2,
  Paused: 3,
  Reclaimed: 4,
};
