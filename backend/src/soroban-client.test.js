import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ContractSimulationError, SorobanClient, serializeArgs } from "./soroban-client.js";

const rawSimulation = JSON.parse(
  readFileSync(new URL("../test/fixtures/soroban-read-response.json", import.meta.url), "utf8"),
);

describe("SorobanClient.readContract", () => {
  it("replays a raw simulation response through the SDK decoder", async () => {
    const client = new SorobanClient();
    client.server._simulateTransaction = mock.fn(async () => rawSimulation);
    client.simulate = mock.fn(() => client.server.simulateTransaction());

    const result = await client.readContract(
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      "get_record",
      [],
    );

    assert.deepStrictEqual(result, {
      id: "18446744073709551615",
      amount: "9007199254740993",
      safeCount: Number.MAX_SAFE_INTEGER,
      status: 0,
      optional: 99,
      absent: null,
      nested: {
        maybe: 7,
        absent: null,
        status: 1,
        values: ["a", "b"],
      },
    });
    assert.strictEqual(client.server._simulateTransaction.mock.callCount(), 1);
  });

  it("throws a typed upstream error for a failed simulation", async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ error: "contract invocation failed" }));

    await assert.rejects(
      client.readContract("CBAD", "get", []),
      (error) =>
        error instanceof ContractSimulationError &&
        error.statusCode === 502 &&
        error.message.includes("contract invocation failed"),
    );
  });

  it("keeps null for a successful simulation with no return value", async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ result: {} }));

    assert.strictEqual(await client.readContract("CEMPTY", "get", []), null);
  });
});

describe("in-flight contract read coalescing", () => {
  it("coalesces identical concurrent reads into a single upstream operation", async () => {
    const client = new SorobanClient();
    let resolveSimulation;
    const pendingSim = new Promise((resolve) => {
      resolveSimulation = resolve;
    });

    client.server._simulateTransaction = mock.fn(async () => rawSimulation);
    client.simulate = mock.fn(async () => {
      await pendingSim;
      return client.server.simulateTransaction();
    });

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    const method = "get_record";
    const args = [client.scvU64(42)];

    // Trigger concurrent reads
    const p1 = client.readContract(contractId, method, args);
    const p2 = client.readContract(contractId, method, args);
    const p3 = client.readContract(contractId, method, args);

    // Verify identical in-flight promise is shared
    assert.strictEqual(p1, p2);
    assert.strictEqual(p2, p3);
    assert.strictEqual(client.inFlight.size, 1);
    assert.strictEqual(client.simulate.mock.callCount(), 1);

    resolveSimulation();
    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

    assert.deepStrictEqual(res1, res2);
    assert.deepStrictEqual(res2, res3);
    assert.strictEqual(res1.id, "18446744073709551615");
    assert.strictEqual(client.inFlight.size, 0);
    assert.strictEqual(client.simulate.mock.callCount(), 1);
  });

  it("performs separate upstream operations for different contracts, methods, arguments, or networks", async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ result: {} }));

    const contractA = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0001";
    const contractB = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0002";

    // Different contracts
    await Promise.all([
      client.readContract(contractA, "get", []),
      client.readContract(contractB, "get", []),
    ]);
    assert.strictEqual(client.simulate.mock.callCount(), 2);

    client.simulate.mock.resetCalls();

    // Different methods
    await Promise.all([
      client.readContract(contractA, "method1", []),
      client.readContract(contractA, "method2", []),
    ]);
    assert.strictEqual(client.simulate.mock.callCount(), 2);

    client.simulate.mock.resetCalls();

    // Different arguments
    await Promise.all([
      client.readContract(contractA, "get", [client.scvU64(1)]),
      client.readContract(contractA, "get", [client.scvU64(2)]),
    ]);
    assert.strictEqual(client.simulate.mock.callCount(), 2);

    client.simulate.mock.resetCalls();

    // Different networks
    await Promise.all([
      client.readContract(contractA, "get", [], { networkPassphrase: "Network-Alpha" }),
      client.readContract(contractA, "get", [], { networkPassphrase: "Network-Beta" }),
    ]);
    assert.strictEqual(client.simulate.mock.callCount(), 2);
  });

  it("propagates upstream failure to all concurrent waiters and removes pending key so retries work", async () => {
    const client = new SorobanClient();
    let resolveSimulation;
    const pendingSim = new Promise((resolve) => {
      resolveSimulation = resolve;
    });

    let attempt = 0;
    client.simulate = mock.fn(async () => {
      attempt++;
      if (attempt === 1) {
        await pendingSim;
        return { error: "temporary upstream simulation failure" };
      }
      return { result: {} };
    });

    const p1 = client.readContract("CFAIL", "query", []);
    const p2 = client.readContract("CFAIL", "query", []);

    assert.strictEqual(client.simulate.mock.callCount(), 1);
    assert.strictEqual(client.inFlight.size, 1);

    resolveSimulation();

    // Both concurrent callers must reject with the upstream error
    await assert.rejects(
      p1,
      (err) =>
        err instanceof ContractSimulationError &&
        err.message.includes("temporary upstream simulation failure"),
    );
    await assert.rejects(
      p2,
      (err) =>
        err instanceof ContractSimulationError &&
        err.message.includes("temporary upstream simulation failure"),
    );

    // In-flight map must be cleared immediately upon failure
    assert.strictEqual(client.inFlight.size, 0);

    // Subsequent read performs a fresh upstream call and succeeds
    const retryResult = await client.readContract("CFAIL", "query", []);
    assert.strictEqual(retryResult, null);
    assert.strictEqual(client.simulate.mock.callCount(), 2);
    assert.strictEqual(client.inFlight.size, 0);
  });

  it("performs fresh upstream operations for sequential reads without caching settled results", async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ result: {} }));

    const res1 = await client.readContract("CSEQ", "get", []);
    assert.strictEqual(res1, null);
    assert.strictEqual(client.simulate.mock.callCount(), 1);
    assert.strictEqual(client.inFlight.size, 0);

    const res2 = await client.readContract("CSEQ", "get", []);
    assert.strictEqual(res2, null);
    assert.strictEqual(client.simulate.mock.callCount(), 2);
    assert.strictEqual(client.inFlight.size, 0);

    const res3 = await client.readContract("CSEQ", "get", []);
    assert.strictEqual(res3, null);
    assert.strictEqual(client.simulate.mock.callCount(), 3);
    assert.strictEqual(client.inFlight.size, 0);
  });

  it("does not cancel other concurrent consumers when one request cancels via AbortSignal", async () => {
    const client = new SorobanClient();
    let resolveSimulation;
    client.simulate = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveSimulation = () => resolve({ result: {} });
        }),
    );

    const controller = new AbortController();
    const p1 = client.readContract("CABORT", "run", [], { signal: controller.signal });
    const p2 = client.readContract("CABORT", "run", []);

    assert.strictEqual(client.simulate.mock.callCount(), 1);
    assert.strictEqual(client.inFlight.size, 1);

    // Abort p1
    controller.abort(new Error("consumer cancelled"));

    await assert.rejects(p1, (err) => err.message === "consumer cancelled");

    // p2 is still pending and simulation is still active
    assert.strictEqual(client.inFlight.size, 1);

    // Now resolve upstream simulation
    resolveSimulation();
    const res2 = await p2;
    assert.strictEqual(res2, null);
    assert.strictEqual(client.inFlight.size, 0);
    assert.strictEqual(client.simulate.mock.callCount(), 1);
  });

  it("ensures independent consumer error handling does not corrupt other consumers", async () => {
    const client = new SorobanClient();
    client.simulate = mock.fn(async () => ({ error: "sim failure" }));

    const p1 = client.readContract("CERR", "get", []);
    const p2 = client.readContract("CERR", "get", []);

    // Consumer 1 attaches fallback error handler
    const consumer1Handled = p1.catch(() => "fallback-value");

    const [res1, res2Result] = await Promise.allSettled([consumer1Handled, p2]);

    assert.strictEqual(res1.status, "fulfilled");
    assert.strictEqual(res1.value, "fallback-value");

    assert.strictEqual(res2Result.status, "rejected");
    assert.ok(res2Result.reason instanceof ContractSimulationError);
  });

  it("serializes arguments deterministically across object key ordering, ScVals, and BigInts", () => {
    const client = new SorobanClient();
    const val1 = serializeArgs([{ b: 1, a: 2 }, client.scvU64(123n), 456n]);
    const val2 = serializeArgs([{ a: 2, b: 1 }, client.scvU64(123n), 456n]);
    assert.strictEqual(val1, val2);

    assert.strictEqual(serializeArgs(undefined), "[]");
    assert.strictEqual(serializeArgs(null), "[]");
  });
});
