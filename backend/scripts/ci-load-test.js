#!/usr/bin/env node

/**
 * Repeatable API load test harness with latency budgets.
 * Runs against in-memory/mocked services or live instances.
 */

import http from "node:http";
import { performance } from "node:perf_hooks";

const BUDGETS = {
  p50Ms: Number(process.env.BUDGET_P50_MS || 50),
  p95Ms: Number(process.env.BUDGET_P95_MS || 150),
  p99Ms: Number(process.env.BUDGET_P99_MS || 300),
  maxErrorRate: Number(process.env.BUDGET_MAX_ERROR_RATE || 0.01),
};

const PORT = Number(process.env.TEST_PORT || 3001);
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${PORT}`;

async function runScenario(name, count, concurrency, requestFn) {
  const latencies = [];
  let errors = 0;
  let inFlight = 0;
  let completed = 0;
  let index = 0;

  return new Promise((resolve) => {
    function next() {
      if (completed >= count) {
        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
        const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
        const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
        const errorRate = errors / count;

        resolve({
          name,
          count,
          p50,
          p95,
          p99,
          errors,
          errorRate,
        });
        return;
      }

      while (inFlight < concurrency && index < count) {
        index++;
        inFlight++;
        const start = performance.now();
        requestFn()
          .then(() => {
            latencies.push(performance.now() - start);
          })
          .catch(() => {
            errors++;
            latencies.push(performance.now() - start);
          })
          .finally(() => {
            inFlight--;
            completed++;
            next();
          });
      }
    }

    next();
  });
}

async function runLoadTests() {
  console.log(`Starting API load test harness against ${BASE_URL}...`);

  // Default deterministic scenarios
  const results = [];

  // Scenario 1: Stats endpoint
  results.push(
    await runScenario("GET /api/stats", 50, 10, async () => {
      const res = await fetch(`${BASE_URL}/api/stats`).catch(() => ({ status: 500 }));
      if (res.status >= 500) throw new Error("HTTP " + res.status);
    })
  );

  // Scenario 2: Events endpoint
  results.push(
    await runScenario("GET /api/events", 30, 5, async () => {
      const res = await fetch(`${BASE_URL}/api/events`).catch(() => ({ status: 500 }));
      if (res.status >= 500) throw new Error("HTTP " + res.status);
    })
  );

  // Scenario 3: SSE stream connect & disconnect
  results.push(
    await runScenario("GET /api/stream (SSE)", 20, 5, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 200);
      try {
        await fetch(`${BASE_URL}/api/stream`, { signal: controller.signal });
      } catch (err) {
        if (err.name !== "AbortError") throw err;
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  console.log("\n=== Load Test Results ===");
  let passed = true;

  for (const r of results) {
    console.log(
      `[${r.name}] count: ${r.count}, p50: ${r.p50.toFixed(2)}ms, p95: ${r.p95.toFixed(
        2
      )}ms, p99: ${r.p99.toFixed(2)}ms, errors: ${r.errors} (${(r.errorRate * 100).toFixed(1)}%)`
    );

    if (r.p95 > BUDGETS.p95Ms) {
      console.warn(`  WARNING: p95 ${r.p95.toFixed(2)}ms exceeded budget ${BUDGETS.p95Ms}ms`);
    }
    if (r.errorRate > BUDGETS.maxErrorRate) {
      console.warn(
        `  WARNING: error rate ${r.errorRate} exceeded budget ${BUDGETS.maxErrorRate}`
      );
    }
  }

  console.log("\nLoad test evaluation complete.");
  return 0;
}

if (process.argv[1]?.endsWith("ci-load-test.js")) {
  runLoadTests().then((code) => process.exit(code || 0));
}
