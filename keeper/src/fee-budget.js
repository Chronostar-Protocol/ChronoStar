import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export class PerTxFeeLimitExceededError extends Error {
  constructor(fee, maxFee) {
    super(`Transaction fee ${fee} stroops exceeds configured MAX_FEE_STROOPS cap of ${maxFee} stroops`);
    this.name = 'PerTxFeeLimitExceededError';
    this.fee = fee;
    this.maxFee = maxFee;
  }
}

export class DailyFeeBudgetExhaustedError extends Error {
  constructor(projected, dailyLimit, windowDate) {
    super(`Daily fee budget exhausted: projected spend (${projected} stroops) exceeds limit of ${dailyLimit} stroops for date ${windowDate}`);
    this.name = 'DailyFeeBudgetExhaustedError';
    this.projected = projected;
    this.dailyLimit = dailyLimit;
    this.windowDate = windowDate;
  }
}

export class FeeBudgetController {
  constructor({
    statePath = '.keeper-fee-budget.json',
    maxFeeStroops = 1_000_000,
    dailyBudgetStroops = 50_000_000,
    now = Date.now,
  } = {}) {
    this.statePath = statePath;
    this.maxFeeStroops = Number(maxFeeStroops) || 0;
    this.dailyBudgetStroops = Number(dailyBudgetStroops) || 0;
    this.now = now;
    this.reservedStroops = 0;
    this.confirmedSpendStroops = 0;
    this.windowDate = this._currentWindowDate();
    this.exhausted = false;
    this._load();
  }

  _currentWindowDate() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  _checkRollover() {
    const today = this._currentWindowDate();
    if (today !== this.windowDate) {
      logger.info(
        { previousDate: this.windowDate, newDate: today, previousSpend: this.confirmedSpendStroops },
        'Daily fee budget window rolled over to new UTC day'
      );
      this.windowDate = today;
      this.confirmedSpendStroops = 0;
      this.reservedStroops = 0;
      this.exhausted = false;
      this._save();
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, 'utf8');
        const data = JSON.parse(raw);
        const today = this._currentWindowDate();
        if (data.windowDate === today) {
          this.confirmedSpendStroops = Number(data.confirmedSpendStroops) || 0;
          this.windowDate = today;
        } else {
          // Rollover from a previous day
          this.windowDate = today;
          this.confirmedSpendStroops = 0;
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to load fee budget state from disk; initializing fresh state');
      this.windowDate = this._currentWindowDate();
      this.confirmedSpendStroops = 0;
    }
  }

  _save() {
    try {
      const data = {
        windowDate: this.windowDate,
        confirmedSpendStroops: this.confirmedSpendStroops,
        reservedStroops: this.reservedStroops,
        updatedAt: new Date(this.now()).toISOString(),
      };
      const dir = path.dirname(this.statePath);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.statePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to persist fee budget state');
    }
  }

  /**
   * Inspects assembled transaction fee before signing.
   * Throws if fee exceeds per-tx cap or daily budget.
   * Reserves fee while in-flight.
   */
  checkAndReserve(feeStroops) {
    this._checkRollover();
    const fee = Number(feeStroops) || 0;

    // 1. Inspect per-transaction fee cap
    if (this.maxFeeStroops > 0 && fee > this.maxFeeStroops) {
      logger.error(
        { fee, maxFeeStroops: this.maxFeeStroops },
        'Transaction fee exceeds per-tx cap; rejecting before signing'
      );
      throw new PerTxFeeLimitExceededError(fee, this.maxFeeStroops);
    }

    // 2. Inspect daily spending budget
    if (this.dailyBudgetStroops > 0) {
      const projected = this.confirmedSpendStroops + this.reservedStroops + fee;
      if (projected > this.dailyBudgetStroops) {
        this.exhausted = true;
        logger.error(
          {
            projected,
            dailyBudgetStroops: this.dailyBudgetStroops,
            confirmedSpendStroops: this.confirmedSpendStroops,
            reservedStroops: this.reservedStroops,
            windowDate: this.windowDate,
          },
          'Daily fee budget exhausted; pausing submissions'
        );
        throw new DailyFeeBudgetExhaustedError(projected, this.dailyBudgetStroops, this.windowDate);
      }
    }

    // Reserve pending fee
    this.reservedStroops += fee;
    this._save();
    return fee;
  }

  /**
   * Confirms spend after transaction settlement.
   */
  confirm(feeStroops) {
    this._checkRollover();
    const fee = Number(feeStroops) || 0;
    this.reservedStroops = Math.max(0, this.reservedStroops - fee);
    this.confirmedSpendStroops += fee;
    this.exhausted = this.exhausted || (this.dailyBudgetStroops > 0 && this.confirmedSpendStroops >= this.dailyBudgetStroops);
    this._save();
  }

  /**
   * Releases reservation if transaction submission was aborted/rejected without executing.
   */
  release(feeStroops) {
    this._checkRollover();
    const fee = Number(feeStroops) || 0;
    this.reservedStroops = Math.max(0, this.reservedStroops - fee);
    this._save();
  }

  status() {
    this._checkRollover();
    return {
      windowDate: this.windowDate,
      maxFeeStroops: this.maxFeeStroops,
      dailyBudgetStroops: this.dailyBudgetStroops,
      confirmedSpendStroops: this.confirmedSpendStroops,
      reservedStroops: this.reservedStroops,
      totalCommittedStroops: this.confirmedSpendStroops + this.reservedStroops,
      exhausted:
        this.exhausted ||
        (this.dailyBudgetStroops > 0 &&
          this.confirmedSpendStroops + this.reservedStroops >= this.dailyBudgetStroops),
    };
  }
}
