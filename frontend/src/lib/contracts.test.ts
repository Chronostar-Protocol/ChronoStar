import { describe, it, expect, vi } from "vitest";
import { Account, rpc, Transaction } from "@stellar/stellar-sdk";
import {
  buildAndSignContractTx,
  validateIntegerAmount,
  validateReleaseLedger,
  createVaultTx,
  claimVaultTx,
  cancelVaultTx,
  createStreamTx,
  createDcaTx,
} from "./contracts";
import { getNetworkPassphrase, DEFAULT_TESTNET_PASSPHRASE } from "./config";

describe("BigInt Integer Amount Validation", () => {
  it("parses valid positive integer strings", () => {
    expect(validateIntegerAmount("1000")).toBe(1000n);
    expect(validateIntegerAmount("1")).toBe(1n);
  });

  it("safely handles amounts exceeding JS MAX_SAFE_INTEGER (2^53 - 1)", () => {
    const largeAmount = "10000000000000000000"; // 10^19 > 9007199254740991
    const result = validateIntegerAmount(largeAmount);
    expect(result).toBe(10000000000000000000n);
  });

  it("rejects zero or negative values", () => {
    expect(() => validateIntegerAmount("0")).toThrow("amount must be greater than zero");
    expect(() => validateIntegerAmount("-500")).toThrow("amount must be a valid integer");
  });

  it("rejects fractional numbers", () => {
    expect(() => validateIntegerAmount("1.5")).toThrow("fractional amounts are not allowed");
    expect(() => validateIntegerAmount("0.001")).toThrow("fractional amounts are not allowed");
  });

  it("rejects exponential notation", () => {
    expect(() => validateIntegerAmount("1e3")).toThrow("cannot be in exponential notation");
    expect(() => validateIntegerAmount("2.5e6")).toThrow("cannot be in exponential notation");
  });

  it("rejects non-numeric characters and empty strings", () => {
    expect(() => validateIntegerAmount("")).toThrow("amount must be greater than zero");
    expect(() => validateIntegerAmount("abc")).toThrow("amount must be a valid integer");
  });
});

describe("Release Ledger Validation", () => {
  it("parses valid ledger numbers", () => {
    expect(validateReleaseLedger("2000000")).toBe(2000000n);
  });

  it("rejects zero or negative sequence numbers", () => {
    expect(() => validateReleaseLedger("0")).toThrow("release_ledger must be in the future");
  });

  it("rejects exponential notation or fractional numbers", () => {
    expect(() => validateReleaseLedger("1e5")).toThrow("cannot be in exponential notation");
    expect(() => validateReleaseLedger("2000.5")).toThrow("release_ledger must be an integer");
  });

  it("rejects ledgers that are not in the future relative to currentLedger", () => {
    expect(() => validateReleaseLedger("100", 100)).toThrow("release_ledger must be in the future");
    expect(() => validateReleaseLedger("99", 100)).toThrow("release_ledger must be in the future");
    expect(validateReleaseLedger("101", 100)).toBe(101n);
  });
});

describe("Network Passphrase Default Agreement", () => {
  it("defaults to the Testnet passphrase matching backend and keeper configs", () => {
    expect(DEFAULT_TESTNET_PASSPHRASE).toBe("Test SDF Network ; September 2015");
    expect(getNetworkPassphrase()).toBe("Test SDF Network ; September 2015");
  });
});

describe("Transaction Builder & Contract Functions", () => {
  const sender = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
  const recipient = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  const token = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
  const contractId = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

  const validVaultParams = {
    recipient,
    token,
    amount: "10000000000000000000",
    releaseLedger: "2000000",
    label: "Test Vault",
  };
  const successfulSubmitter = () => vi.fn(async () => ({ hash: "ab".repeat(32) }));

  it("builds and wallet-signs create_vault before submitting it", async () => {
    const signerMock = vi.fn(async (xdr: string) => xdr);
    const submitter = successfulSubmitter();
    const result = await createVaultTx(sender, validVaultParams, {
      signer: signerMock,
      submitter,
      contractId,
      skipSimulation: true,
    });

    expect(result.hash).toBe("ab".repeat(32));
    expect(result.xdr).toBeDefined();
    expect(signerMock).toHaveBeenCalledWith(expect.any(String), {
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(submitter).toHaveBeenCalledWith(result.xdr);
    expect(signerMock.mock.invocationCallOrder[0]).toBeLessThan(
      submitter.mock.invocationCallOrder[0],
    );
  });

  it("prepares and submits through Soroban RPC when no submitter override is provided", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const getAccount = vi
      .spyOn(server, "getAccount")
      .mockResolvedValue(new Account(sender, "0"));
    const prepareTransaction = vi
      .spyOn(server, "prepareTransaction")
      .mockImplementation(async (transaction) => transaction as Transaction);
    const hash = "cd".repeat(32);
    const sendTransaction = vi.spyOn(server, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash,
      latestLedger: 100,
      latestLedgerCloseTime: 0,
    });
    const signer = vi.fn(async (xdr: string) => xdr);

    const result = await buildAndSignContractTx(sender, contractId, "test", [], {
      signer,
      server,
    });

    expect(result.hash).toBe(hash);
    expect(getAccount).toHaveBeenCalledWith(sender);
    expect(prepareTransaction).toHaveBeenCalledOnce();
    expect(signer).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it("surfaces amount validation errors before building tx", async () => {
    await expect(createVaultTx(sender, { ...validVaultParams, amount: "0" })).rejects.toThrow(
      "amount must be greater than zero",
    );

    await expect(createVaultTx(sender, { ...validVaultParams, amount: "1.5" })).rejects.toThrow(
      "fractional amounts are not allowed",
    );
  });

  it("surfaces releaseLedger validation errors before building tx", async () => {
    await expect(
      createVaultTx(sender, { ...validVaultParams, releaseLedger: "0" }),
    ).rejects.toThrow("release_ledger must be in the future");
  });

  it("handles user cancellation gracefully", async () => {
    const signerMock = vi.fn(async () => null);
    await expect(
      createVaultTx(sender, validVaultParams, {
        signer: signerMock,
        contractId,
        skipSimulation: true,
      }),
    ).rejects.toThrow("User declined transaction signing");
  });

  it("builds and signs claimVaultTx", async () => {
    const signerMock = vi.fn(async (xdr: string) => xdr);
    const submitter = successfulSubmitter();
    const result = await claimVaultTx(recipient, 42n, {
      signer: signerMock,
      submitter,
      contractId,
      skipSimulation: true,
    });

    expect(result.hash.length).toBe(64);
    expect(signerMock).toHaveBeenCalled();
    expect(submitter).toHaveBeenCalled();
  });

  it("builds and signs cancelVaultTx", async () => {
    const signerMock = vi.fn(async (xdr: string) => xdr);
    const submitter = successfulSubmitter();
    const result = await cancelVaultTx(sender, 42n, {
      signer: signerMock,
      submitter,
      contractId,
      skipSimulation: true,
    });

    expect(result.hash.length).toBe(64);
    expect(signerMock).toHaveBeenCalled();
    expect(submitter).toHaveBeenCalled();
  });

  it("builds and signs createStreamTx", async () => {
    const signerMock = vi.fn(async (xdr: string) => xdr);
    const submitter = successfulSubmitter();
    const result = await createStreamTx(
      sender,
      {
        recipient,
        token,
        totalAmount: "100000",
        durationLedgers: "2000",
        label: "Stream 1",
      },
      {
        signer: signerMock,
        submitter,
        contractId,
        skipSimulation: true,
      },
    );

    expect(result.hash).toBe("ab".repeat(32));
    expect(signerMock).toHaveBeenCalled();
    expect(submitter).toHaveBeenCalledWith(result.xdr);
  });

  it("rejects createStreamTx with a non-positive duration", async () => {
    await expect(
      createStreamTx(sender, {
        recipient,
        token,
        totalAmount: "100000",
        durationLedgers: "0",
      }),
    ).rejects.toThrow("duration_ledgers must be greater than zero");
  });

  it("builds and signs createDcaTx", async () => {
    const signerMock = vi.fn(async (xdr: string) => xdr);
    const submitter = successfulSubmitter();
    const result = await createDcaTx(
      sender,
      {
        tokenIn: token,
        swapReceiver: recipient,
        totalBudget: "2500",
        amountPerSwap: "500",
        intervalLedgers: "120",
        label: "DCA 1",
      },
      {
        signer: signerMock,
        submitter,
        contractId,
        skipSimulation: true,
      },
    );

    expect(result.hash).toBe("ab".repeat(32));
    expect(signerMock).toHaveBeenCalled();
    expect(submitter).toHaveBeenCalledWith(result.xdr);
  });

  it("rejects DCA budgets that are not an exact multiple of the swap amount", async () => {
    await expect(
      createDcaTx(sender, {
        tokenIn: token,
        swapReceiver: recipient,
        totalBudget: "2501",
        amountPerSwap: "500",
        intervalLedgers: "120",
      }),
    ).rejects.toThrow("total_budget must be an exact multiple of amount_per_swap");
  });

  it("rejects submissions without a valid returned transaction hash", async () => {
    await expect(
      createVaultTx(sender, validVaultParams, {
        signer: async (xdr) => xdr,
        submitter: async () => ({ hash: "" }),
        contractId,
        skipSimulation: true,
      }),
    ).rejects.toThrow("Transaction submission did not return a valid transaction hash");
  });
});
