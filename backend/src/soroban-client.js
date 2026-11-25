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

export class SorobanClient {
  constructor() {
    const isInsecureHttp = config.rpcUrl.startsWith("http://");
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: isInsecureHttp });
    this.networkPassphrase = config.networkPassphrase;
    this.inflight = new Map();
  }

  async simulate(contractId, method, args) {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);
    const source = Keypair.random();
    const acc = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(acc, {
      fee: null,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(0)
      .build();
    const simulation = await this.server.simulateTransaction(tx);
    return simulation;
  }

  async readContract(contractId, method, args) {
    const key = `${this.networkPassphrase}:${contractId}:${method}:${JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`;
    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const promise = (async () => {
      try {
        const sim = await this.simulate(contractId, method, args);
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
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
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
