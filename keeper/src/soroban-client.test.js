import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { Account, Keypair } from "@stellar/stellar-sdk";
import { SorobanClient } from "./soroban-client.js";
import { config } from "./config.js";

const TEST_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const TEST_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("SorobanClient", () => {
  it("invokes contract, signs prepared transaction, and returns correlationId and hash", async () => {
    const client = new SorobanClient();
    client.sourceAccount = new Account(TEST_ACCOUNT, "1");
    const signMock = mock.fn();
    client.sourceKeypair = {
      publicKey: () => TEST_ACCOUNT,
      sign: signMock,
    };

    client._buildTx = mock.fn(() => ({ built: true }));
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
      sign: (kp) => kp.sign(),
    }));

    const result = await client.invokeContract(
      TEST_CONTRACT,
      "test_method",
      [],
      "test-correlation-id-12345",
    );
    assert.strictEqual(result.hash, "txhash1234567890");
    assert.strictEqual(result.correlationId, "test-correlation-id-12345");
    assert.strictEqual(client._buildTx.mock.callCount(), 1);
    assert.strictEqual(
      client._buildTx.mock.calls[0].arguments[4],
      "test-correlation-id-12345",
    );
    assert.strictEqual(client._assemble.mock.callCount(), 1);
    assert.strictEqual(signMock.mock.callCount(), 1);
  });

  it("polls getTransaction when sendTransaction returns PENDING", async () => {
    const client = new SorobanClient();
    client.sourceAccount = new Account(TEST_ACCOUNT, "1");
    client.sourceKeypair = {
      publicKey: () => TEST_ACCOUNT,
      sign: () => {},
    };
    client._buildTx = mock.fn(() => ({ built: true }));
    client._assemble = mock.fn(() => ({ sign: () => {} }));
    client.server = {
      simulateTransaction: mock.fn(async () => ({
        result: { retval: null },
        transactionData: {},
      })),
      sendTransaction: mock.fn(async () => ({
        status: "PENDING",
        hash: "pending_hash_001",
      })),
      getTransaction: mock.fn(async () => ({
        status: "SUCCESS",
        ledger: 1234,
      })),
    };

    const result = await client.invokeContract(
      TEST_CONTRACT,
      "release",
      [],
      "corr-pending",
    );
    assert.strictEqual(result.hash, "pending_hash_001");
    assert.strictEqual(result.status, "SUCCESS");
    assert.strictEqual(result.correlationId, "corr-pending");
    assert.strictEqual(client.server.getTransaction.mock.callCount(), 1);
  });

  it("refreshes source account sequence on submission failure and retries", async () => {
    const client = new SorobanClient();
    let getAccountCalls = 0;

    const originalAttempts = config.retryMaxAttempts;
    const originalDelay = config.retryBaseDelayMs;
    config.retryMaxAttempts = 2;
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
      assert.strictEqual(getAccountCalls, 2);
      assert.strictEqual(client.server.simulateTransaction.mock.callCount(), 2);
    } finally {
      config.retryMaxAttempts = originalAttempts;
      config.retryBaseDelayMs = originalDelay;
    }
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
