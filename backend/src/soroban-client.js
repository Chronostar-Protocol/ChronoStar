import { rpc, Contract, xdr, Address, Keypair, Account, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { config } from './config.js';
import { logger } from './logger.js';

export class SorobanClient {
  constructor() {
    const isInsecureHttp = config.rpcUrl.startsWith('http://');
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: isInsecureHttp });
    this.networkPassphrase = config.networkPassphrase;
  }

  async simulate(contractId, method, args) {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);
    const source = Keypair.random();
    const acc = new Account(source.publicKey(), '0');
    const tx = new TransactionBuilder(acc, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(0)
      .build();
    const simulation = await this.server.simulateTransaction(tx);
    return simulation;
  }

  async readContract(contractId, method, args) {
    const sim = await this.simulate(contractId, method, args);
    if (!sim?.result?.retval) return null;
    return normalizeNative(scValToNative(sim.result.retval));
  }

  scvU64(val) { return xdr.ScVal.scvU64(BigInt(val)); }
  scvAddress(addr) {
    return Address.fromString(addr).toScVal();
  }
}

function normalizeNative(value) {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] === 'string') {
      const ordinal = STATUS_ORDINALS[value[0]];
      if (ordinal !== undefined) return ordinal;
    }
    return value.map(normalizeNative);
  }
  if (value && typeof value === 'object') {
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
};
