import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  FeeBudgetController,
  PerTxFeeLimitExceededError,
  DailyFeeBudgetExhaustedError,
} from './fee-budget.js';

const TEST_STATE_PATH = path.join(process.cwd(), '.test-fee-budget.json');

describe('FeeBudgetController', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_STATE_PATH)) {
      fs.unlinkSync(TEST_STATE_PATH);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STATE_PATH)) {
      fs.unlinkSync(TEST_STATE_PATH);
    }
  });

  it('enforces per-transaction fee cap', () => {
    const ctrl = new FeeBudgetController({
      statePath: TEST_STATE_PATH,
      maxFeeStroops: 10_000,
      dailyBudgetStroops: 100_000,
    });

    // Below limit
    ctrl.checkAndReserve(5_000);
    ctrl.release(5_000);

    // Over limit
    assert.throws(() => {
      ctrl.checkAndReserve(10_001);
    }, PerTxFeeLimitExceededError);
  });

  it('enforces daily fee budget and transitions to exhausted', () => {
    const ctrl = new FeeBudgetController({
      statePath: TEST_STATE_PATH,
      maxFeeStroops: 10_000,
      dailyBudgetStroops: 15_000,
    });

    ctrl.checkAndReserve(8_000);
    ctrl.confirm(8_000);

    // Remaining daily is 7_000, trying to reserve 8_000 should throw
    assert.throws(() => {
      ctrl.checkAndReserve(8_000);
    }, DailyFeeBudgetExhaustedError);

    const st = ctrl.status();
    assert.strictEqual(st.exhausted, true);
  });

  it('resets budget on day rollover', () => {
    let mockTime = Date.parse('2026-11-20T12:00:00Z');
    const ctrl = new FeeBudgetController({
      statePath: TEST_STATE_PATH,
      maxFeeStroops: 20_000,
      dailyBudgetStroops: 15_000,
      now: () => mockTime,
    });

    ctrl.checkAndReserve(15_000);
    ctrl.confirm(15_000);
    assert.strictEqual(ctrl.status().exhausted, true);

    // Advance 24 hours
    mockTime += 24 * 60 * 60 * 1000;
    const nextDayStatus = ctrl.status();
    assert.strictEqual(nextDayStatus.exhausted, false);
    assert.strictEqual(nextDayStatus.confirmedSpendStroops, 0);
  });
});
