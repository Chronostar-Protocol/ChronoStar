import { describe, it, expect } from "vitest";
import {
  generateTransactionReceipt,
  type GenerateReceiptInput,
} from "./contracts";

describe("Transaction Receipt Generator (#416)", () => {
  const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const validContractId = "CAQVSBNVL7OI66IDTYCR7XL4VJKMSOYGBW5D6SWLTWTINTCQO2OGCSXS";

  it("generates a complete receipt with confirmed hash, ledger, and unambiguous metadata", () => {
    const input: GenerateReceiptInput = {
      network: "TESTNET",
      contractId: validContractId,
      method: "create_vault",
      hash: validHash,
      ledger: 1234567,
      status: "SUCCESS",
      parameters: {
        recipient: "GDYPHJ7H2DO6OUWD5ZJRLFT57QNUZYOWBBYEHEQBAGJDFBAAFJWMXSNU",
        token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        amount: "50000000",
        releaseLedger: 1300000,
        label: "Team Retainer",
      },
    };

    const receipt = generateTransactionReceipt(input);

    expect(receipt.status).toBe("SUCCESS");
    expect(receipt.hash).toBe(validHash);
    expect(receipt.ledger).toBe(1234567);
    expect(receipt.network).toBe("TESTNET");
    expect(receipt.contractId).toBe(validContractId);
    expect(receipt.method).toBe("create_vault");
    expect(receipt.parameters.amount).toBe("50000000");
    expect(typeof receipt.parameters.amount).toBe("string");
    expect(receipt.timestamp).toBeDefined();
  });

  it("ensures raw integer amounts remain strings (preserving BigInt without precision loss)", () => {
    const input: GenerateReceiptInput = {
      contractId: validContractId,
      method: "create_stream",
      hash: validHash,
      status: "SUCCESS",
      parameters: {
        totalAmount: 10000000000000000000000n, // Large BigInt amount
        durationLedgers: 50000n,
      },
    };

    const receipt = generateTransactionReceipt(input);

    expect(receipt.parameters.totalAmount).toBe("10000000000000000000000");
    expect(typeof receipt.parameters.totalAmount).toBe("string");
    expect(receipt.parameters.durationLedgers).toBe("50000");
  });

  it("rejects pending transactions and throws error", () => {
    const input: GenerateReceiptInput = {
      contractId: validContractId,
      method: "create_vault",
      hash: validHash,
      status: "PENDING",
      parameters: { amount: "100" },
    };

    expect(() => generateTransactionReceipt(input)).toThrow(
      /Cannot generate receipt for unconfirmed transaction/
    );
  });

  it("rejects failed transactions and throws error", () => {
    const input: GenerateReceiptInput = {
      contractId: validContractId,
      method: "create_vault",
      hash: validHash,
      status: "ERROR",
      parameters: { amount: "100" },
    };

    expect(() => generateTransactionReceipt(input)).toThrow(
      /Cannot generate receipt for unconfirmed transaction/
    );
  });

  it("rejects malformed or short transaction hashes", () => {
    const input: GenerateReceiptInput = {
      contractId: validContractId,
      method: "create_vault",
      hash: "short-invalid-hash",
      status: "SUCCESS",
      parameters: {},
    };

    expect(() => generateTransactionReceipt(input)).toThrow(
      /missing or invalid transaction hash/
    );
  });

  it("rejects empty contractId or method", () => {
    expect(() =>
      generateTransactionReceipt({
        contractId: "",
        method: "create_vault",
        hash: validHash,
        status: "SUCCESS",
        parameters: {},
      })
    ).toThrow(/contractId is required/);

    expect(() =>
      generateTransactionReceipt({
        contractId: validContractId,
        method: "",
        hash: validHash,
        status: "SUCCESS",
        parameters: {},
      })
    ).toThrow(/method is required/);
  });
});
