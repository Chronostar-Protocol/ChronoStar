import {
  Account,
  Address,
  Contract,
  nativeToScVal,
  rpc,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { config, getNetworkPassphrase } from "./config";

export interface VaultParams {
  recipient: string;
  token: string;
  amount: string;
  releaseLedger: string;
  label?: string;
  expiresAfterLedger?: number | null;
}

export interface StreamParams {
  recipient: string;
  token: string;
  totalAmount: string;
  durationLedgers: string;
  label?: string;
}

export interface DcaParams {
  tokenIn: string;
  swapReceiver: string;
  totalBudget: string;
  amountPerSwap: string;
  intervalLedgers: string;
  label?: string;
}

export interface ContractTxOptions {
  signer?: (
    transactionXdr: string,
    options?: { networkPassphrase?: string },
  ) => Promise<string | null>;
  server?: rpc.Server;
  submitter?: (signedXdr: string) => Promise<{ hash: string }>;
  networkPassphrase?: string;
  rpcUrl?: string;
  contractId?: string;
  currentLedger?: number | bigint;
  skipSimulation?: boolean;
}

const MAX_I128 = (1n << 127n) - 1n;
const MAX_U32 = 4294967295n;

/**
 * Validates token amounts as strict positive integers using BigInt.
 * Rejects exponential notation, fractional values, zero, and negative values.
 */
export function validateIntegerAmount(value: string, name = "amount"): bigint {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be greater than zero`);
  }
  const trimmed = value.trim();

  // Reject exponential notation (e.g. 1e3, 1E6)
  if (/[eE]/.test(trimmed)) {
    throw new Error(`${name} cannot be in exponential notation`);
  }

  // Reject fractional numbers (e.g. 1.5, 0.05)
  if (trimmed.includes(".")) {
    throw new Error(`${name} must be an integer, fractional amounts are not allowed`);
  }

  // Reject non-numeric characters
  if (!/^\+?\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a valid integer`);
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error(`${name} must be greater than zero`);
  }

  if (parsed > MAX_I128) {
    throw new Error(`${name} exceeds maximum token supply limit`);
  }

  return parsed;
}

/**
 * Validates ledger sequence numbers as strict positive u32 integers.
 */
export function validateReleaseLedger(value: string, currentLedger?: number | bigint): bigint {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("release_ledger must be in the future");
  }
  const trimmed = value.trim();

  if (/[eE]/.test(trimmed)) {
    throw new Error("release_ledger cannot be in exponential notation");
  }

  if (trimmed.includes(".")) {
    throw new Error("release_ledger must be an integer");
  }

  if (!/^\+?\d+$/.test(trimmed)) {
    throw new Error("release_ledger must be a valid integer");
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error("release_ledger must be in the future");
  }

  if (currentLedger !== undefined && parsed <= BigInt(currentLedger)) {
    throw new Error("release_ledger must be in the future");
  }

  if (parsed > MAX_U32) {
    throw new Error("release_ledger exceeds maximum ledger sequence");
  }

  return parsed;
}

function validatePositiveLedgerCount(value: string, name: string): bigint {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be greater than zero`);
  }
  const trimmed = value.trim();

  if (/[eE]/.test(trimmed)) {
    throw new Error(`${name} cannot be in exponential notation`);
  }
  if (trimmed.includes(".")) {
    throw new Error(`${name} must be an integer`);
  }
  if (!/^\+?\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a valid integer`);
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error(`${name} must be greater than zero`);
  }
  if (parsed > MAX_U32) {
    throw new Error(`${name} exceeds maximum ledger sequence`);
  }
  return parsed;
}

/**
 * Core transaction builder: prepares, signs, and submits Soroban contract invocations.
 */
export async function buildAndSignContractTx(
  senderAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr: string }> {
  if (!senderAddress) {
    throw new Error("Sender address is required");
  }
  if (!contractId) {
    throw new Error("Contract ID is required");
  }

  const networkPassphrase = options?.networkPassphrase || getNetworkPassphrase();
  const rpcUrl = options?.rpcUrl || config.rpcUrl;
  const server = options?.server || new rpc.Server(rpcUrl);
  const signer = options?.signer || signTransaction;

  const contract = new Contract(contractId);
  const operation = contract.call(method, ...args);

  const sourceAccount = options?.skipSimulation
    ? new Account(senderAddress, "0")
    : await server.getAccount(senderAddress);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const preparedTx = options?.skipSimulation ? tx : await server.prepareTransaction(tx);

  const signedXdr = await signer(preparedTx.toXDR(), { networkPassphrase });
  if (!signedXdr) {
    throw new Error("User declined transaction signing");
  }

  let txHash: string;
  if (options?.submitter) {
    const res = await options.submitter(signedXdr);
    txHash = res.hash;
  } else {
    const signedTx = new Transaction(signedXdr, networkPassphrase);
    const sendRes = await server.sendTransaction(signedTx);
    if (sendRes.status !== "PENDING" && sendRes.status !== "DUPLICATE") {
      throw new Error(`Transaction submission failed: ${sendRes.status}`);
    }
    txHash = sendRes.hash;
  }

  if (!/^[\da-f]{64}$/i.test(txHash)) {
    throw new Error("Transaction submission did not return a valid transaction hash");
  }

  return { hash: txHash, xdr: signedXdr };
}

/**
 * Builds and signs a real `create_vault` Soroban transaction.
 */
export async function createVaultTx(
  senderAddress: string,
  params: VaultParams,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const amountBig = validateIntegerAmount(params.amount, "amount");
  const releaseBig = validateReleaseLedger(params.releaseLedger, options?.currentLedger);

  const contractId = options?.contractId || config.vaultContractId;
  if (!contractId) throw new Error("Vault contract ID is not configured");
  const label = params.label?.trim() || "Vault";

  const args: xdr.ScVal[] = [
    new Address(senderAddress).toScVal(),
    new Address(params.recipient).toScVal(),
    new Address(params.token).toScVal(),
    nativeToScVal(amountBig, { type: "i128" }),
    nativeToScVal(Number(releaseBig), { type: "u32" }),
    nativeToScVal(label),
    params.expiresAfterLedger
      ? nativeToScVal(params.expiresAfterLedger, { type: "u32" })
      : xdr.ScVal.scvVoid(),
  ];

  return buildAndSignContractTx(senderAddress, contractId, "create_vault", args, options);
}

/**
 * Builds and signs a `claim_vault` Soroban transaction.
 */
export async function claimVaultTx(
  recipientAddress: string,
  vaultId: number | bigint,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const contractId = options?.contractId || config.vaultContractId;
  if (!contractId) throw new Error("Vault contract ID is not configured");
  const args: xdr.ScVal[] = [
    new Address(recipientAddress).toScVal(),
    nativeToScVal(BigInt(vaultId), { type: "u64" }),
  ];
  return buildAndSignContractTx(recipientAddress, contractId, "claim_vault", args, options);
}

/**
 * Builds and signs a `cancel_vault` Soroban transaction.
 */
export async function cancelVaultTx(
  ownerAddress: string,
  vaultId: number | bigint,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const contractId = options?.contractId || config.vaultContractId;
  if (!contractId) throw new Error("Vault contract ID is not configured");
  const args: xdr.ScVal[] = [
    new Address(ownerAddress).toScVal(),
    nativeToScVal(BigInt(vaultId), { type: "u64" }),
  ];
  return buildAndSignContractTx(ownerAddress, contractId, "cancel_vault", args, options);
}

/**
 * Builds and signs a `create_stream` Soroban transaction.
 */
export async function createStreamTx(
  senderAddress: string,
  params: StreamParams,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const totalAmount = validateIntegerAmount(params.totalAmount, "total_amount");
  const durationLedgers = validatePositiveLedgerCount(params.durationLedgers, "duration_ledgers");
  const contractId = options?.contractId || config.streamContractId;
  if (!contractId) throw new Error("Stream contract ID is not configured");

  const args: xdr.ScVal[] = [
    new Address(senderAddress).toScVal(),
    new Address(params.recipient).toScVal(),
    new Address(params.token).toScVal(),
    nativeToScVal(totalAmount, { type: "i128" }),
    nativeToScVal(Number(durationLedgers), { type: "u32" }),
    nativeToScVal(0, { type: "u32" }),
    nativeToScVal(params.label?.trim() || "Stream"),
    nativeToScVal(0, { type: "u32" }),
  ];

  return buildAndSignContractTx(senderAddress, contractId, "create_stream", args, options);
}

/**
 * Builds and signs a `pause` stream Soroban transaction.
 */
export async function pauseStreamTx(
  ownerAddress: string,
  streamId: number | bigint,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const contractId = options?.contractId || config.streamContractId;
  if (!contractId) throw new Error("Stream contract ID is not configured");
  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(streamId), { type: "u64" }),
  ];
  return buildAndSignContractTx(ownerAddress, contractId, "pause", args, options);
}

/**
 * Builds and signs a `resume` stream Soroban transaction.
 */
export async function resumeStreamTx(
  ownerAddress: string,
  streamId: number | bigint,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const contractId = options?.contractId || config.streamContractId;
  if (!contractId) throw new Error("Stream contract ID is not configured");
  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(streamId), { type: "u64" }),
  ];
  return buildAndSignContractTx(ownerAddress, contractId, "resume", args, options);
}

/**
 * Builds and signs a `create_dca` Soroban transaction.
 */
export async function createDcaTx(
  senderAddress: string,
  params: DcaParams,
  options?: ContractTxOptions,
): Promise<{ hash: string; xdr?: string }> {
  const totalBudget = validateIntegerAmount(params.totalBudget, "total_budget");
  const amountPerSwap = validateIntegerAmount(params.amountPerSwap, "amount_per_swap");
  if (totalBudget % amountPerSwap !== 0n) {
    throw new Error("total_budget must be an exact multiple of amount_per_swap");
  }
  const intervalLedgers = validatePositiveLedgerCount(params.intervalLedgers, "interval_ledgers");
  const contractId = options?.contractId || config.dcaContractId;
  if (!contractId) throw new Error("DCA contract ID is not configured");

  const args: xdr.ScVal[] = [
    new Address(senderAddress).toScVal(),
    new Address(params.tokenIn).toScVal(),
    new Address(params.swapReceiver).toScVal(),
    nativeToScVal(totalBudget, { type: "i128" }),
    nativeToScVal(amountPerSwap, { type: "i128" }),
    nativeToScVal(Number(intervalLedgers), { type: "u32" }),
    nativeToScVal(params.label?.trim() || "DCA"),
  ];

  return buildAndSignContractTx(senderAddress, contractId, "create_dca", args, options);
}
