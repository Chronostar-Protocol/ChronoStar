import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkWasmBudgets, DEFAULT_BUDGETS } from './check-wasm-budget.js';

describe('WASM Size Budget Enforcement (#438)', () => {
  it('passes when all contracts are within budget', () => {
    const mockSizes = {
      schedule_vault: 45_000,
      recurring_stream: 48_000,
      dca_policy: 52_000,
      keeper_coordinator: 30_000,
    };

    const res = checkWasmBudgets({ mockSizes });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.violations.length, 0);
    assert.strictEqual(res.report.length, 4);
    assert.match(res.md, /# Contract WASM Size Budget Report/);
  });

  it('fails with offending contract name when budget is exceeded', () => {
    const mockSizes = {
      schedule_vault: 70_000, // Budget is 65_536
      recurring_stream: 48_000,
      dca_policy: 52_000,
      keeper_coordinator: 30_000,
    };

    const res = checkWasmBudgets({ mockSizes });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.violations.length, 1);
    assert.strictEqual(res.violations[0].name, 'schedule_vault');
    assert.strictEqual(res.violations[0].status, 'EXCEEDED');
    assert.ok(res.violations[0].diff > 0);
  });
});
