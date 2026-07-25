import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PolymarketConnectionManager } from './connection-manager.js';
import { ensureBookReady } from './ensure-book-ready.js';

const fetchOrderBook = vi.fn();
const sleep = vi.fn().mockResolvedValue(undefined);

vi.mock('./api-client.js', () => ({
  fetchOrderBook: (...args: unknown[]) => fetchOrderBook(...args),
}));

vi.mock('@polywatch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@polywatch/core')>();
  return {
    ...actual,
    sleep: (...args: unknown[]) => sleep(...args),
  };
});

describe('ensureBookReady', () => {
  beforeEach(() => {
    fetchOrderBook.mockReset();
    sleep.mockClear();
  });

  it('returns true when cache already has a bilateral book', async () => {
    fetchOrderBook.mockResolvedValue({
      bids: [{ price: 0.4, size: 10 }],
      asks: [{ price: 0.42, size: 10 }],
    });

    const manager = new PolymarketConnectionManager();
    await manager.fetchBook('token-ready');

    const ok = await ensureBookReady(manager, 'token-ready');
    expect(ok).toBe(true);
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries REST fetch until bilateral book appears', async () => {
    fetchOrderBook
      .mockRejectedValueOnce(new Error('CLOB book error: 404'))
      .mockRejectedValueOnce(new Error('CLOB book error: 404'))
      .mockResolvedValueOnce({
        bids: [{ price: 0.7, size: 5 }],
        asks: [{ price: 0.72, size: 5 }],
      });

    const manager = new PolymarketConnectionManager();
    const ok = await ensureBookReady(manager, 'token-new');

    expect(ok).toBe(true);
    expect(fetchOrderBook).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('returns false when book never becomes available', async () => {
    fetchOrderBook.mockRejectedValue(new Error('CLOB book error: 404'));

    const manager = new PolymarketConnectionManager();
    const ok = await ensureBookReady(manager, 'token-missing');

    expect(ok).toBe(false);
    expect(fetchOrderBook.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('refreshes when cache has a stale bilateral book', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));

    fetchOrderBook
      .mockResolvedValueOnce({
        bids: [{ price: 0.57, size: 10 }],
        asks: [{ price: 0.58, size: 10 }],
      })
      .mockResolvedValueOnce({
        bids: [{ price: 0.12, size: 10 }],
        asks: [{ price: 0.14, size: 10 }],
      });

    const manager = new PolymarketConnectionManager();
    await manager.fetchBook('token-stale');
    expect(fetchOrderBook).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);

    const ok = await ensureBookReady(manager, 'token-stale');
    expect(ok).toBe(true);
    expect(fetchOrderBook).toHaveBeenCalledTimes(2);
    expect(manager.getOrderBook('token-stale')?.bids[0]?.price).toBe(0.12);

    vi.useRealTimers();
  });

  it('returns false immediately when abortSignal is already aborted', async () => {
    fetchOrderBook.mockRejectedValue(new Error('CLOB book error: 404'));
    const manager = new PolymarketConnectionManager();
    const ac = new AbortController();
    ac.abort();

    const ok = await ensureBookReady(manager, 'token-aborted', ac.signal);

    expect(ok).toBe(false);
    expect(fetchOrderBook).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns false when abortSignal fires during retry sleep', async () => {
    fetchOrderBook.mockRejectedValue(new Error('CLOB book error: 404'));
    const manager = new PolymarketConnectionManager();
    const ac = new AbortController();
    const pending = ensureBookReady(manager, 'token-abort-mid', ac.signal);
    ac.abort();
    const ok = await pending;

    expect(ok).toBe(false);
  });
});
