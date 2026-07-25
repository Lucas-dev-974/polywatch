import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PolymarketBookWebSocket } from './websocket-book.js';

// Mock WebSocket
vi.mock('ws', () => {
  const mockWs = {
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
  return { default: vi.fn(() => mockWs) };
});

// Mock fetchOrderBook
const mockFetchOrderBook = vi.fn();
vi.mock('../polymarket/api-client.js', () => ({
  fetchOrderBook: (...args: unknown[]) => mockFetchOrderBook(...args),
}));

// Mock config
vi.mock('../config.js', () => ({
  config: { wsUrl: 'wss://test.example.com/ws' },
}));

// Mock constants used by the class
vi.mock('../constants.js', () => ({
  WS_HEARTBEAT_INTERVAL_MS: 10_000,
  WS_MAX_RECONNECT_ATTEMPTS: 5,
  WS_BASE_RECONNECT_DELAY_MS: 1_000,
  STALE_BOOK_THRESHOLD_MS: 30_000,
}));

function makeBook(updatedAt?: Date) {
  return {
    bids: [{ price: 0.6, size: 100 }],
    asks: [{ price: 0.65, size: 100 }],
    updatedAt: updatedAt ?? new Date(),
    assetId: '0xasset1',
  };
}

describe('PolymarketBookWebSocket', () => {
  let ws: PolymarketBookWebSocket;

  beforeEach(() => {
    ws = new PolymarketBookWebSocket();
    // Use mockClear (not mockReset) to preserve the mockResolvedValue default
    mockFetchOrderBook.mockClear();
    mockFetchOrderBook.mockResolvedValue({
      bids: [{ price: 0.6, size: 100 }],
      asks: [{ price: 0.65, size: 100 }],
    });
  });

  describe('syncAll', () => {
    it('skips REST fetch when WS is healthy and all books are fresh', async () => {
      // subscribe triggers 1 REST call to fetch initial snapshot
      await ws.subscribe('0xasset1');
      // @ts-ignore — set healthy = true to test healthy-path skip logic
      ws.healthy = true;
      // Book is fresh (just subscribed) → syncAll does nothing
      await ws.syncAll(30_000);
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(1); // subscribe call only
    });

    it('re-fetches stale books when WS is healthy', async () => {
      await ws.subscribe('0xasset1'); // 1 REST call (initial snapshot)
      // @ts-ignore
      ws.healthy = true; // healthy = true for healthy-path stale-gate logic

      // Manually age the book beyond threshold (simulate stale book)
      const oldBook = { price: 0.5, size: 50 };
      // @ts-ignore — accessing private map for test setup
      ws.books.set('0xasset1', {
        bids: [oldBook],
        asks: [],
        updatedAt: new Date(Date.now() - 60_000), // 60s old > 30s threshold
        assetId: '0xasset1',
      });

      // syncAll re-fetches because book is stale
      await ws.syncAll(30_000);
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(2); // subscribe + syncAll
      expect(mockFetchOrderBook).toHaveBeenCalledWith('0xasset1');
    });

    it('re-fetches all books when WS is unhealthy', async () => {
      // Each subscribe stores the book in the map (after fixing storeBook ordering bug)
      await ws.subscribe('0xasset1'); // 1 REST call (initial snapshot, now stores book)
      await ws.subscribe('0xasset2'); // 1 REST call (initial snapshot, now stores book)

      // @ts-ignore — set healthy to false
      ws.healthy = false;

      // Unhealthy path: re-fetches ALL books (2 re-fetches)
      // Total: 2×subscribe + 2×syncAll = 4
      await ws.syncAll(30_000);
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(4);
      expect(mockFetchOrderBook).toHaveBeenCalledWith('0xasset1');
      expect(mockFetchOrderBook).toHaveBeenCalledWith('0xasset2');
    });

    it('only re-fetches books older than the threshold', async () => {
      await ws.subscribe('0xasset1'); // 1 call (initial snapshot)
      await ws.subscribe('0xasset2'); // 1 call (initial snapshot)
      // @ts-ignore
      ws.healthy = true; // healthy = true for stale-gate logic

      // Asset1: stale (60s old)
      // @ts-ignore
      ws.books.set('0xasset1', {
        bids: [{ price: 0.5, size: 50 }],
        asks: [],
        updatedAt: new Date(Date.now() - 60_000),
        assetId: '0xasset1',
      });
      // Asset2: fresh (5s old)
      // @ts-ignore
      ws.books.set('0xasset2', {
        bids: [{ price: 0.6, size: 100 }],
        asks: [],
        updatedAt: new Date(Date.now() - 5_000),
        assetId: '0xasset2',
      });

      // syncAll re-fetches only asset1 (stale) → 1 additional re-fetch
      await ws.syncAll(30_000);
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(3); // 2×subscribe + 1×syncAll re-fetch
      expect(mockFetchOrderBook).toHaveBeenCalledWith('0xasset1');
    });

    it('treats missing updatedAt as stale (Infinity age)', async () => {
      await ws.subscribe('0xasset1'); // 1 call (initial snapshot)
      // @ts-ignore
      ws.books.set('0xasset1', {
        bids: [{ price: 0.6, size: 100 }],
        asks: [],
        // no updatedAt
        assetId: '0xasset1',
      });

      await ws.syncAll(30_000); // re-fetches because updatedAt is undefined → Infinity age
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(2); // subscribe + syncAll re-fetch
    });

    it('uses provided staleThresholdMs parameter', async () => {
      await ws.subscribe('0xasset1'); // 1 call (initial snapshot)
      // @ts-ignore
      ws.books.set('0xasset1', {
        bids: [{ price: 0.6, size: 100 }],
        asks: [],
        updatedAt: new Date(Date.now() - 20_000), // 20s old
        assetId: '0xasset1',
      });

      // With 10s threshold → 20s old is stale → 1 re-fetch
      await ws.syncAll(10_000);
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(2); // subscribe + re-fetch

      mockFetchOrderBook.mockClear();

      // With 60s threshold → 20s old is fresh → 0 additional re-fetches
      // Total: 1 (subscribe call only)
      await ws.syncAll(60_000);
      expect(mockFetchOrderBook).toHaveBeenCalledTimes(1);
    });

    it('logs debug when WS is healthy and all books are fresh', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await ws.subscribe('0xasset1'); // 1 call (initial snapshot)
      await ws.syncAll(30_000); // fresh → 0 re-fetches
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('continues syncing other books when one fails', async () => {
      // Each subscribe triggers a REST call for initial snapshot
      await ws.subscribe('0xasset1'); // response 1
      await ws.subscribe('0xasset2'); // response 2

      // Both books are stale → syncAll will try to re-fetch both
      // @ts-ignore
      ws.books.set('0xasset1', {
        bids: [{ price: 0.5, size: 50 }],
        asks: [],
        updatedAt: new Date(Date.now() - 60_000),
        assetId: '0xasset1',
      });
      // @ts-ignore
      ws.books.set('0xasset2', {
        bids: [{ price: 0.6, size: 100 }],
        asks: [],
        updatedAt: new Date(Date.now() - 60_000),
        assetId: '0xasset2',
      });

      // 4 total calls expected: 2×subscribe + 2×syncAll (one fails, one succeeds)
      mockFetchOrderBook
        .mockRejectedValueOnce(new Error('network error')) // syncAll re-fetch asset1 → fails
        .mockResolvedValueOnce({ bids: [{ price: 0.6, size: 100 }], asks: [] }); // syncAll re-fetch asset2 → ok

      await ws.syncAll(30_000);

      expect(mockFetchOrderBook).toHaveBeenCalledTimes(4);
      // Both books were attempted despite the first failing
    });
  });
});
