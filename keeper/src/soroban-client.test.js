import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { Account, Keypair, xdr } from "@stellar/stellar-sdk";
import {
  LedgerStalledError,
  NetworkIdentityMismatchError,
  PerTxFeeLimitExceededError,
  DailyFeeBudgetExhaustedError,
  SorobanClient,
} from "./soroban-client.js";
import { config } from "./config.js";

const TEST_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const TEST_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("SorobanClient", () => {
  it("builds transaction with memo and returns correlationId and hash", async () => {
    const client = new SorobanClient();
    client.sourceAccount = new Account(TEST_ACCOUNT, "1");
    client.sourceKeypair = {
      publicKey: () => TEST_ACCOUNT,
      sign: () => {},
    };

    client.server = {
      getAccount: mock.fn(async () => new Account(TEST_ACCOUNT, "1")),
      simulateTransaction: mock.fn(async () => ({
        result: { retval: null },
        transactionData: {},
      })),
      sendTransaction: mock.fn(async () => ({
        status: "SUCCESS",
        hash: "txhash1234567890",
      })),
    };

    client._assemble = mock.fn(() => ({
      sign: () => {},
      fee: "100",
    }));

    const result = await client.invokeContract(
      TEST_CONTRACT,
      "test_method",
      [],
      "test-correlation-id-12345",
    );
    assert.strictEqual(result.hash, "txhash1234567890");
    assert.strictEqual(result.correlationId, "test-correlation-id-12345");
    assert.strictEqual(client._assemble.mock.callCount(), 1);
  });

  it("suspends submissions on a stalled ledger and resumes after forward progress", async () => {
    let now = 1_000;
    let ledger = 100;
    const originalStallDuration = config.maxLedgerStallMs;
    config.maxLedgerStallMs = 100;

    const client = new SorobanClient({ now: () => now });
    client.sourceAccount = new Account(TEST_ACCOUNT, "1");
    client.sourceKeypair = { publicKey: () => TEST_ACCOUNT, sign: () => {} };
    client.server = {
      simulateTransaction: mock.fn(async () => ({
        latestLedger: ledger,
        result: { retval: xdr.ScVal.scvVoid() },
        transactionData: {},
      })),
      sendTransaction: mock.fn(async () => ({ status: "SUCCESS", hash: "txhash" })),
    };
    client._assemble = mock.fn(() => ({ sign: () => {}, fee: "100" }));

    try {
      assert.equal(client.ledgerStatus().status, "unknown");
      await client.readContract(TEST_CONTRACT, "current_ledger", []);
      assert.equal(client.ledgerStatus().status, "healthy");

      now += 100;
      await client.readContract(TEST_CONTRACT, "current_ledger", []);
      assert.equal(client.ledgerStatus().status, "stalled");
      await assert.rejects(
        client.invokeContract(TEST_CONTRACT, "submit", []),
        LedgerStalledError,
      );
      assert.equal(client.server.sendTransaction.mock.callCount(), 0);

      ledger += 1;
      await client.readContract(TEST_CONTRACT, "current_ledger", []);
      assert.equal(client.ledgerStatus().status, "healthy");
      await client.invokeContract(TEST_CONTRACT, "submit", []);
      assert.equal(client.server.sendTransaction.mock.callCount(), 1);
    } finally {
      config.maxLedgerStallMs = originalStallDuration;
    }
  });

  it("does not report an RPC transport failure as a ledger stall", async () => {
    let now = 1_000;
    let shouldFail = true;
    const client = new SorobanClient({ now: () => now });
    const originalStallDuration = config.maxLedgerStallMs;
    config.maxLedgerStallMs = 100;
    client.server = {
      simulateTransaction: mock.fn(async () => {
        if (shouldFail) throw new Error("RPC unavailable");
        return { latestLedger: 100, result: { retval: xdr.ScVal.scvVoid() }, transactionData: {} };
      }),
    };

    try {
      await assert.rejects(client.readContract(TEST_CONTRACT, "current_ledger", []), /RPC unavailable/);
      assert.equal(client.ledgerStatus().status, "transport_error");

      shouldFail = false;
      await client.readContract(TEST_CONTRACT, "current_ledger", []);
      now += 100;
      shouldFail = true;
      await assert.rejects(client.readContract(TEST_CONTRACT, "current_ledger", []), /RPC unavailable/);
      assert.equal(client.ledgerStatus().status, "transport_error");

      shouldFail = false;
      await client.readContract(TEST_CONTRACT, "current_ledger", []);
      assert.equal(client.ledgerStatus().status, "stalled");
    } finally {
      config.maxLedgerStallMs = originalStallDuration;
    }
  });

  it("refreshes source account sequence on submission failure", async () => {
    const client = new SorobanClient();
    let getAccountCalls = 0;

    const originalAttempts = config.retryMaxAttempts;
    const originalDelay = config.retryBaseDelayMs;
    config.retryMaxAttempts = 1;
    config.retryBaseDelayMs = 0;

    client.sourceKeypair = {
      publicKey: () => TEST_ACCOUNT,
      sign: mock.fn(),
    };

    client.server = {
      getAccount: mock.fn(async () => {
        getAccountCalls++;
        return new Account(TEST_ACCOUNT, String(100 + getAccountCalls));
      }),
      simulateTransaction: mock.fn(async () => ({ error: "sim_error" })),
    };

    client.sourceAccount = new Account(TEST_ACCOUNT, "100");

    try {
      await assert.rejects(
        () => client.invokeContract(TEST_CONTRACT, "test_method", []),
        /test_method simulation failed: sim_error/,
      );
      assert.ok(getAccountCalls > 0);
    } finally {
      config.retryMaxAttempts = originalAttempts;
      config.retryBaseDelayMs = originalDelay;
    }
  });
});

describe("SorobanClient network identity (#434)", () => {
  it("verifies successfully when RPC passphrase matches configured passphrase", async () => {
    const client = new SorobanClient();
    client.server = {
      getNetwork: mock.fn(async () => ({
        passphrase: config.networkPassphrase,
        protocolVersion: 21,
      })),
    };

    const net = await client.verifyNetworkIdentity();
    assert.strictEqual(net.passphrase, config.networkPassphrase);
    assert.strictEqual(client.networkVerified, true);
  });

  it("throws NetworkIdentityMismatchError when RPC passphrase differs", async () => {
    const client = new SorobanClient();
    client.server = {
      getNetwork: mock.fn(async () => ({
        passphrase: "Wrong Passphrase ; 2024",
        protocolVersion: 21,
      })),
    };

    await assert.rejects(
      () => client.verifyNetworkIdentity(),
      NetworkIdentityMismatchError
    );
    assert.strictEqual(client.networkVerified, false);
  });
});

describe("SorobanClient fee budget and journal enforcement (#435, #436)", () => {
  it("enforces fee budget cap and refuses submission before signing", async () => {
    const client = new SorobanClient();
    client.sourceAccount = new Account(TEST_ACCOUNT, "1");
    client.sourceKeypair = {
      publicKey: () => TEST_ACCOUNT,
      sign: mock.fn(),
    };

    client.server = {
      simulateTransaction: mock.fn(async () => ({
        result: { retval: null },
        transactionData: {},
      })),
      sendTransaction: mock.fn(),
    };

    // Assembled tx with fee 2_000_000 stroops
    client._assemble = mock.fn(() => ({
      fee: "2000000",
      sign: mock.fn(),
    }));

    // Mock fee budget controller to throw per-tx fee error
    client.feeBudget = {
      checkAndReserve: mock.fn(() => {
        throw new PerTxFeeLimitExceededError(2_000_000, 1_000_000);
      }),
      release: mock.fn(),
      confirm: mock.fn(),
      status: mock.fn(() => ({})),
    };

    await assert.rejects(
      () => client.invokeContract(TEST_CONTRACT, "huge_tx", []),
      PerTxFeeLimitExceededError
    );

    // Ensure it never signed or sent
    assert.strictEqual(client.server.sendTransaction.mock.callCount(), 0);
  });
});

describe("SorobanClient coordinator registration", () => {
  const keeper = Keypair.random().publicKey();

  function registrationClient() {
    const client = new SorobanClient();
    client.sourceKeypair = { publicKey: () => keeper };
    client.invokeContract = mock.fn(async () => ({ status: "SUCCESS", hash: "h" }));
    client.readContract = mock.fn(async () => true);
    return client;
  }

  it('register invokes the coordinator "register" with the keeper address', async () => {
    const client = registrationClient();
    await client.register("CCOORD");
    const [contractId, method, args] = client.invokeContract.mock.calls[0].arguments;
    assert.strictEqual(contractId, "CCOORD");
    assert.strictEqual(method, "register");
    assert.strictEqual(args.length, 1);
    assert.strictEqual(args[0].type, "scvAddress");
  });

  it('unregister invokes the coordinator "unregister"', async () => {
    const client = registrationClient();
    await client.unregister("CCOORD");
    assert.strictEqual(client.invokeContract.mock.calls[0].arguments[1], "unregister");
  });

  it("isRegistered reads is_registered and coerces to a boolean", async () => {
    const client = registrationClient();
    assert.strictEqual(await client.isRegistered("CCOORD"), true);
    client.readContract = mock.fn(async () => undefined);
    assert.strictEqual(await client.isRegistered("CCOORD"), false);
    assert.strictEqual(client.readContract.mock.calls[0].arguments[1], "is_registered");
  });

  it("refuses to build a registration call without a keeper secret", async () => {
    const client = new SorobanClient();
    client.sourceKeypair = null;
    await assert.rejects(client.register("CCOORD"), /keeper secret required/);
  });
});
