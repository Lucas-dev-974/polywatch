import { describe, it, expect } from 'vitest';
import type { CopiedPosition } from '@polywatch/core';
import { resolveMarkBidForExit } from './position-evaluator.js';

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
