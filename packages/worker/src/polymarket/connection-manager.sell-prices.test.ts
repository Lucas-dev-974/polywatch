import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PolymarketConnectionManager } from './connection-manager.js';

const fetchOrderBook = vi.fn();

vi.mock('./api-client.js', () => ({
  fetchOrderBook: (...args: unknown[]) => fetchOrderBook(...args),
}));

describe('fetchSellExecutablePrices', () => {
  beforeEach(() => {
    fetchOrderBook.mockReset();
  });

  it('uses in-memory book when bid vwap is positive', async () => {
    fetchOrderBook.mockResolvedValue({
      bids: [{ price: 0.99, size: 100 }],
      asks: [{ price: 1, size: 100 }],
    });

    const manager = new PolymarketConnectionManager();
    await manager.fetchBook('token-a');

    const prices = await manager.fetchSellExecutablePrices('token-a', 10);

    expect(prices.executableBidVwap).toBeGreaterThan(0);
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);
  });

  it('REST-fallbacks when the asset is not subscribed', async () => {
    fetchOrderBook.mockResolvedValue({
      bids: [{ price: 0.42, size: 50 }],
      asks: [{ price: 0.44, size: 50 }],
    });

    const manager = new PolymarketConnectionManager();
    const prices = await manager.fetchSellExecutablePrices('token-b', 5);

    expect(prices.executableBidVwap).toBeCloseTo(0.42, 4);
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);
  });

  it('REST-fallbacks when cached book has no bids', async () => {
    fetchOrderBook
      .mockResolvedValueOnce({
        bids: [],
        asks: [{ price: 0.9, size: 100 }],
      })
      .mockResolvedValueOnce({
        bids: [{ price: 0.35, size: 20 }],
        asks: [{ price: 0.37, size: 20 }],
      });

    const manager = new PolymarketConnectionManager();
    await manager.fetchBook('token-c');

    const prices = await manager.fetchSellExecutablePrices('token-c', 10);

    expect(prices.executableBidVwap).toBeCloseTo(0.35, 4);
    expect(fetchOrderBook).toHaveBeenCalledTimes(2);
  });
});
