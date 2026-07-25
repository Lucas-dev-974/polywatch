import { describe, expect, it } from 'vitest';
import {
  computeBuyCashDebit,
  computeEntryInvestedFromBuyExecutions,
  computeSellSettlement,
  replaySimCashDelta,
  type SimExecutionCashRow,
} from './accounting.js';

describe('computeEntryInvestedFromBuyExecutions', () => {
  it('sums filled BUY cost including fees', () => {
    const snapshot = computeEntryInvestedFromBuyExecutions([
      {
        side: 'BUY',
        status: 'filled',
        fillPrice: 0.42,
        fillQuantity: 2.3809524,
        fees: 0.0174,
      },
    ]);
    expect(snapshot.quantity).toBeCloseTo(2.3809524, 4);
    expect(snapshot.amount).toBeCloseTo(1.0174, 4);
  });

  it('ignores failed and SELL executions', () => {
    const snapshot = computeEntryInvestedFromBuyExecutions([
      {
        side: 'BUY',
        status: 'failed',
        fillPrice: 0.5,
        fillQuantity: 10,
        fees: 0.1,
      },
      {
        side: 'SELL',
        status: 'filled',
        fillPrice: 0.7,
        fillQuantity: 10,
        fees: 0.02,
      },
    ]);
    expect(snapshot.quantity).toBe(0);
    expect(snapshot.amount).toBe(0);
  });
});

describe('computeBuyCashDebit', () => {
  it('includes fees in debit', () => {
    expect(computeBuyCashDebit(0.6, 100, 0.05)).toBeCloseTo(60.05, 4);
  });
});

describe('computeSellSettlement', () => {
  it('deducts exit fees and entry fee allocation on normal sell', () => {
    const s = computeSellSettlement({
      isRedemption: false,
      fillPrice: 0.7,
      fillQuantity: 10,
      inputFees: 0.02,
      entryPrice: 0.5,
      entryFeesRemaining: 0.1,
      entryQuantityRemaining: 10,
    });
    expect(s.exitFees).toBe(0.02);
    expect(s.feeAlloc).toBeCloseTo(0.1, 4);
    expect(s.cashCredit).toBeCloseTo(6.98, 4);
    expect(s.realizedPnl).toBeCloseTo(1.88, 4);
  });

  it('credits full payoff on redemption without re-deducting entry fees', () => {
    const s = computeSellSettlement({
      isRedemption: true,
      fillPrice: 1,
      fillQuantity: 50,
      inputFees: 0,
      entryPrice: 0.6,
      entryFeesRemaining: 0.2,
      entryQuantityRemaining: 50,
    });
    expect(s.exitFees).toBe(0);
    expect(s.cashCredit).toBe(50);
    expect(s.realizedPnl).toBeCloseTo(19.8, 4);
  });
});

describe('replaySimCashDelta', () => {
  it('nets buy debits and sell credits for a round trip', () => {
    const executions: SimExecutionCashRow[] = [
      {
        copiedPositionId: 1,
        side: 'BUY',
        reason: 'COPY_OPEN',
        fillPrice: 0.5,
        fillQuantity: 10,
        fees: 0.05,
      },
      {
        copiedPositionId: 1,
        side: 'SELL',
        reason: 'TP',
        fillPrice: 0.7,
        fillQuantity: 10,
        fees: 0.02,
      },
    ];
    const delta = replaySimCashDelta(executions);
    const expected =
      0.7 * 10 -
      0.02 -
      (0.5 * 10 + 0.05);
    expect(delta).toBeCloseTo(expected, 4);
  });

  it('ignores duplicate sells beyond remaining entry quantity', () => {
    const executions: SimExecutionCashRow[] = [
      {
        copiedPositionId: 1,
        side: 'BUY',
        reason: 'COPY_OPEN',
        fillPrice: 0.42,
        fillQuantity: 2.38,
        fees: 0.02,
      },
      {
        copiedPositionId: 1,
        side: 'SELL',
        reason: 'TRAILING',
        fillPrice: 0.85,
        fillQuantity: 2.38,
        fees: 0.01,
      },
      {
        copiedPositionId: 1,
        side: 'SELL',
        reason: 'TRAILING',
        fillPrice: 0.85,
        fillQuantity: 2.38,
        fees: 0.01,
      },
    ];
    const once = replaySimCashDelta(executions.slice(0, 2));
    const twice = replaySimCashDelta(executions);
    expect(twice).toBeCloseTo(once, 6);
  });
});
