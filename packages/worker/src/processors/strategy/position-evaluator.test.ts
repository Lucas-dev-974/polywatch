import { describe, it, expect } from 'vitest';
import type { CopiedPosition } from '@polywatch/core';
import { computePnlSnapshot, resolveMarkBidForExit } from './position-evaluator.js';

function makePos(
  overrides: Partial<CopiedPosition> = {},
): CopiedPosition {
  return {
    id: 1,
    quantity: 1,
    entryPrice: 0.86,
    entryBidVwap: 0.85,
    executableBidVwap: 0.41,
    entryFeesRemaining: 0.01,
    entryQuantityRemaining: 1,
    mode: 'sim',
    ...overrides,
  } as CopiedPosition;
}

describe('resolveMarkBidForExit', () => {
  it('prefers executable bid when present', () => {
    expect(
      resolveMarkBidForExit(makePos(), 0.55, { wsBestBid: 0.4 }),
    ).toBe(0.55);
  });

  it('falls back to WS best bid when executable bid is zero', () => {
    expect(
      resolveMarkBidForExit(makePos(), 0, { wsBestBid: 0.42 }),
    ).toBe(0.42);
  });

  it('falls back to persisted mark when book is empty', () => {
    expect(resolveMarkBidForExit(makePos(), 0, {})).toBe(0.41);
  });
});

describe('computePnlSnapshot weather uPnL', () => {
  it('t0 bid == entryBid -> uPnL is remaining fees only', () => {
    const snap = computePnlSnapshot(
      0.32,
      makePos({
        reason: 'WEATHER_OPEN',
        entryPrice: 0.41,
        entryBidVwap: 0.32,
        quantity: 10,
        entryFeesRemaining: 0.05,
        entryQuantityRemaining: 10,
      }),
    );
    expect(snap.unrealizedPnl).toBeCloseTo(-0.05, 4);
    expect(snap.closure).toBeLessThan(0);
  });

  it('bid up -> green uPnL', () => {
    const snap = computePnlSnapshot(
      0.35,
      makePos({
        reason: 'WEATHER_OPEN',
        entryPrice: 0.41,
        entryBidVwap: 0.32,
        quantity: 10,
        entryFeesRemaining: 0.05,
        entryQuantityRemaining: 10,
      }),
    );
    expect(snap.unrealizedPnl).toBeCloseTo((0.35 - 0.32) * 10 - 0.05, 4);
    expect(snap.unrealizedPnl).toBeGreaterThan(0);
  });

  it('copy keeps bid vs entry ask', () => {
    const snap = computePnlSnapshot(
      0.32,
      makePos({
        reason: 'COPY_OPEN',
        entryPrice: 0.41,
        entryBidVwap: 0.32,
        quantity: 10,
        entryFeesRemaining: 0.05,
        entryQuantityRemaining: 10,
      }),
    );
    expect(snap.unrealizedPnl).toBeCloseTo((0.32 - 0.41) * 10 - 0.05, 4);
  });
});