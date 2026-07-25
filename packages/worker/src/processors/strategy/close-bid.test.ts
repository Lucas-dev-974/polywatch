import { describe, expect, it } from 'vitest';
import { LAST_CLOSEABLE_BID_MAX_AGE_MS } from '@polywatch/core';
import { resolveCloseBid } from './close-bid.js';

describe('resolveCloseBid', () => {
  it('uses last closeable bid for pre-close when fresh', () => {
    expect(
      resolveCloseBid(0, undefined, null, 0.52, new Date(), true),
    ).toBe(0.52);
  });

  it('ignores stale last closeable bid', () => {
    const stale = new Date(Date.now() - LAST_CLOSEABLE_BID_MAX_AGE_MS - 1_000);
    expect(
      resolveCloseBid(0, undefined, null, 0.52, stale, true),
    ).toBe(0);
  });

  it('does not use last closeable bid when allowStaleLastBid is false', () => {
    expect(
      resolveCloseBid(0, undefined, null, 0.52, new Date(), false),
    ).toBe(0);
  });

  it('prefers fresh lastCloseable over sized residual bestBid', () => {
    expect(
      resolveCloseBid(0, undefined, null, 0.38, new Date(), true, 0.01),
    ).toBe(0.38);
  });

  it('uses sized residual bestBid when no lastCloseable', () => {
    expect(
      resolveCloseBid(0, undefined, null, null, null, true, 0.22),
    ).toBe(0.22);
  });

  it('rejects sized bestBid anomalously low vs lastCloseable even if stale', () => {
    const stale = new Date(Date.now() - LAST_CLOSEABLE_BID_MAX_AGE_MS - 1_000);
    expect(
      resolveCloseBid(0, undefined, null, 0.38, stale, true, 0.01),
    ).toBe(0);
  });

  it('uses liveBestBid before lastCloseable', () => {
    expect(
      resolveCloseBid(0, 0.4, null, 0.38, new Date(), true, 0.01),
    ).toBe(0.4);
  });
});
