import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { Account, Keypair } from "@stellar/stellar-sdk";
import { SorobanClient } from "./soroban-client.js";
import { config } from "./config.js";

const TEST_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const TEST_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("SorobanClient", () => {
  it("builds transaction and returns correlationId and hash", async () => {
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

  it("refreshes source account sequence on submission failure and succeeds on retry", async () => {
    const client = new SorobanClient();
    let getAccountCalls = 0;
    let simCalls = 0;

    const originalAttempts = config.retryMaxAttempts;
    const originalDelay = config.retryBaseDelayMs;
    config.retryMaxAttempts = 2;
    config.retryBaseDelayMs = 0;

    client.sourceKeypair = {
      publicKey: () => TEST_ACCOUNT,
      sign: mock.fn(),
    };
    client._assemble = mock.fn(() => ({ sign: () => {} }));

    client.server = {
      getAccount: mock.fn(async () => {
        getAccountCalls++;
        return new Account(TEST_ACCOUNT, String(100 + getAccountCalls));
      }),
      simulateTransaction: mock.fn(async () => {
        simCalls++;
        if (simCalls === 1) return { error: "sim_error" };
        return { result: { retval: null }, transactionData: {} };
      }),
      sendTransaction: mock.fn(async () => ({
        status: "PENDING",
        hash: "retry_tx_hash",
      })),
      getTransaction: mock.fn(async () => ({
        status: "SUCCESS",
      })),
    };

    client.sourceAccount = new Account(TEST_ACCOUNT, "100");

    try {
      const result = await client.invokeContract(
        TEST_CONTRACT,
        "test_method",
        [],
        "corr-retry-ok",
      );
      assert.strictEqual(result.hash, "retry_tx_hash");
      assert.strictEqual(result.correlationId, "corr-retry-ok");
      assert.strictEqual(getAccountCalls, 1);
      assert.strictEqual(simCalls, 2);
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
