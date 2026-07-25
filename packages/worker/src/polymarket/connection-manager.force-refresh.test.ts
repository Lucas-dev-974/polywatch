import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PolymarketConnectionManager } from './connection-manager.js';
import { ALGO_BOOK_FRESH_MS } from './book-freshness.js';

const fetchOrderBook = vi.fn();

vi.mock('./api-client.js', () => ({
  fetchOrderBook: (...args: unknown[]) => fetchOrderBook(...args),
}));

describe('fetchBook freshness', () => {
  beforeEach(() => {
    fetchOrderBook.mockReset();
    vi.useRealTimers();
  });

  it('refetches REST when cached book exceeds maxAgeMs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    fetchOrderBook
      .mockResolvedValueOnce({
        bids: [{ price: 0.5, size: 100 }],
        asks: [{ price: 0.52, size: 100 }],
      })
      .mockResolvedValueOnce({
        bids: [{ price: 0.12, size: 50 }],
        asks: [{ price: 0.14, size: 50 }],
      });

    const manager = new PolymarketConnectionManager();
    await manager.fetchBook('token-stale');
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ALGO_BOOK_FRESH_MS + 1_000);

    const refreshed = await manager.fetchBook('token-stale', {
      maxAgeMs: ALGO_BOOK_FRESH_MS,
    });
    expect(fetchOrderBook).toHaveBeenCalledTimes(2);
    expect(refreshed?.bids[0]?.price).toBe(0.12);

    vi.useRealTimers();
  });
});

describe('forceRefreshBook', () => {
  beforeEach(() => {
    fetchOrderBook.mockReset();
  });

  it('ignores cache and always hits REST', async () => {
    fetchOrderBook
      .mockResolvedValueOnce({
        bids: [{ price: 0.5, size: 100 }],
        asks: [{ price: 0.52, size: 100 }],
      })
      .mockResolvedValueOnce({
        bids: [{ price: 0.3, size: 10 }],
        asks: [{ price: 0.32, size: 10 }],
      });

    const manager = new PolymarketConnectionManager();
    await manager.fetchBook('token-x');
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);

    // Cache hit — fetchBook must NOT call REST again
    await manager.fetchBook('token-x');
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);

    const refreshed = await manager.forceRefreshBook('token-x');
    expect(fetchOrderBook).toHaveBeenCalledTimes(2);
    expect(refreshed?.bids[0]?.price).toBe(0.3);
  });

  it('returns undefined when REST fails', async () => {
    fetchOrderBook.mockRejectedValue(new Error('network'));
    const manager = new PolymarketConnectionManager();
    const book = await manager.forceRefreshBook('token-y');
    expect(book).toBeUndefined();
  });
});
