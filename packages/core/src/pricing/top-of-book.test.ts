import { describe, expect, it } from 'vitest';
import { computeTopOfBook, computeExecutableSpread } from './top-of-book.js';

describe('computeTopOfBook', () => {
  it('returns spread from best bid and ask', () => {
    const quote = computeTopOfBook({
      bids: [{ price: 0.48, size: 10 }],
      asks: [{ price: 0.52, size: 8 }],
    });
    expect(quote?.bestBid).toBe(0.48);
    expect(quote?.bestAsk).toBe(0.52);
    expect(quote?.spreadTop).toBeCloseTo(0.04);
  });

  it('returns null when book is empty', () => {
    expect(computeTopOfBook({ bids: [], asks: [] })).toBeNull();
  });
});

describe('computeExecutableSpread', () => {
  it('computes vwap spread for quantity', () => {
    const spread = computeExecutableSpread(
      {
        bids: [{ price: 0.48, size: 100 }],
        asks: [{ price: 0.52, size: 100 }],
      },
      10,
    );
    expect(spread).toBeCloseTo(0.04);
  });
});
