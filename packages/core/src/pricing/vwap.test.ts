import { describe, expect, it } from 'vitest';
import {
  closurePnlPercent,
  computeExecutableAskVwap,
  computeExecutableBidVwap,
  simulateFakFill,
  triggerPnlPercent,
  unrealizedPnl,
} from './vwap.js';

describe('computeExecutableBidVwap', () => {
  it('computes full fill VWAP', () => {
    const result = computeExecutableBidVwap(
      {
        bids: [
          { price: 0.6, size: 50 },
          { price: 0.59, size: 50 },
        ],
      },
      80,
    );
    expect(result.liquidityStatus).toBe('ok');
    expect(result.filledQuantity).toBe(80);
    expect(result.vwap).toBeCloseTo((50 * 0.6 + 30 * 0.59) / 80, 6);
  });

  it('returns partial when depth insufficient', () => {
    const result = computeExecutableBidVwap(
      { bids: [{ price: 0.5, size: 10 }] },
      100,
    );
    expect(result.liquidityStatus).toBe('partial');
    expect(result.filledQuantity).toBe(10);
    expect(result.vwap).toBe(0.5);
  });

  it('returns illiquid when no bids', () => {
    const result = computeExecutableBidVwap({ bids: [] }, 10);
    expect(result.liquidityStatus).toBe('illiquid');
    expect(result.vwap).toBe(0);
  });
});

describe('computeExecutableAskVwap', () => {
  it('walks asks ascending', () => {
    const result = computeExecutableAskVwap(
      {
        asks: [
          { price: 0.61, size: 40 },
          { price: 0.62, size: 60 },
        ],
      },
      50,
    );
    expect(result.liquidityStatus).toBe('ok');
    expect(result.vwap).toBeCloseTo((40 * 0.61 + 10 * 0.62) / 50, 6);
  });
});

describe('simulateFakFill', () => {
  const asks = [
    { price: 0.62, size: 60 },
    { price: 0.61, size: 40 },
  ];
  const bids = [
    { price: 0.59, size: 30 },
    { price: 0.6, size: 50 },
  ];

  it('fills fully when depth within limit covers quantity (BUY)', () => {
    const fill = simulateFakFill(asks, 50, 0.62, 'BUY');
    expect(fill.fillQuantity).toBe(50);
    expect(fill.vwap).toBeCloseTo((40 * 0.61 + 10 * 0.62) / 50, 6);
  });

  it('fills partially when limit price excludes deeper levels (BUY)', () => {
    const fill = simulateFakFill(asks, 100, 0.61, 'BUY');
    expect(fill.fillQuantity).toBe(40);
    expect(fill.vwap).toBeCloseTo(0.61, 6);
  });

  it('fills partially when book depth is insufficient (SELL)', () => {
    const fill = simulateFakFill(bids, 200, 0.59, 'SELL');
    expect(fill.fillQuantity).toBe(80);
    expect(fill.vwap).toBeCloseTo((50 * 0.6 + 30 * 0.59) / 80, 6);
  });

  it('returns empty fill when no level is within limit (SELL)', () => {
    const fill = simulateFakFill(bids, 10, 0.65, 'SELL');
    expect(fill.fillQuantity).toBe(0);
    expect(fill.vwap).toBe(0);
  });

  it('returns empty fill on empty book', () => {
    const fill = simulateFakFill([], 10, 0.5, 'BUY');
    expect(fill.fillQuantity).toBe(0);
    expect(fill.vwap).toBe(0);
  });
});

describe('PNL formulas', () => {
  it('computes triggerPnlPercent vs entry bid', () => {
    expect(triggerPnlPercent(0.68, 0.598)).toBeCloseTo(13.712, 2);
  });

  it('computes closurePnlPercent vs entry price without fees', () => {
    expect(closurePnlPercent(0.68, 0.602, 0, 1)).toBeCloseTo(12.957, 2);
  });

  it('computes closurePnlPercent with entry fees spread over quantity', () => {
    const withoutFees = closurePnlPercent(0.68, 0.602, 0, 1);
    const withFees = closurePnlPercent(0.68, 0.602, 0.006, 1);
    expect(withoutFees).toBeCloseTo(12.957, 2);
    expect(withFees).toBeCloseTo(11.84, 2);
    expect(withFees).toBeLessThan(withoutFees);
  });

  it('closurePnlPercent reaches -100% when bid wipes invested capital', () => {
    // 1 share bought at 0.5 with 0.1 entry fees => cost basis 0.6 per share
    expect(closurePnlPercent(0, 0.5, 0.1, 1)).toBeCloseTo(-100, 2);
  });

  it('computes unrealizedPnl', () => {
    expect(unrealizedPnl(0.68, 0.602, 100)).toBeCloseTo(7.8, 2);
    expect(unrealizedPnl(0.68, 0.602, 100, 0.5)).toBeCloseTo(7.3, 2);
  });
});
