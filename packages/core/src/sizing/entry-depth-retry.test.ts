import { describe, expect, it, vi } from 'vitest';
import {
  fetchEntryAskLiquidityWithRetries,
  isEntryAskDepthSufficient,
} from './entry-depth-retry.js';

describe('isEntryAskDepthSufficient', () => {
  it('requires ok ask liquidity and positive ask vwap', () => {
    expect(
      isEntryAskDepthSufficient({
        executableBidVwap: 0.5,
        executableAskVwap: 0.6,
        liquidityStatus: 'partial',
        askLiquidityStatus: 'ok',
      }),
    ).toBe(true);
    expect(
      isEntryAskDepthSufficient({
        executableBidVwap: 0.5,
        executableAskVwap: 0.6,
        liquidityStatus: 'ok',
        askLiquidityStatus: 'partial',
      }),
    ).toBe(false);
  });
});

describe('fetchEntryAskLiquidityWithRetries', () => {
  it('returns immediately when depth is sufficient', async () => {
    const fetchExecutablePrices = vi.fn().mockResolvedValue({
      executableBidVwap: 0.5,
      executableAskVwap: 0.6,
      liquidityStatus: 'partial',
      askLiquidityStatus: 'ok',
    });

    const result = await fetchEntryAskLiquidityWithRetries({
      assetId: 'asset-1',
      targetQty: 5,
      maxRetries: 3,
      delayMs: 1000,
      connectionManager: { fetchExecutablePrices },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(1);
    }
    expect(fetchExecutablePrices).toHaveBeenCalledTimes(1);
  });

  it('retries until depth is sufficient', async () => {
    const fetchExecutablePrices = vi
      .fn()
      .mockResolvedValueOnce({
        executableBidVwap: 0.5,
        executableAskVwap: 0.6,
        liquidityStatus: 'partial',
        askLiquidityStatus: 'partial',
      })
      .mockResolvedValueOnce({
        executableBidVwap: 0.5,
        executableAskVwap: 0.6,
        liquidityStatus: 'partial',
        askLiquidityStatus: 'ok',
      });
    const forceRefreshBook = vi.fn().mockResolvedValue(undefined);

    const result = await fetchEntryAskLiquidityWithRetries({
      assetId: 'asset-1',
      targetQty: 5,
      maxRetries: 3,
      delayMs: 0,
      connectionManager: { fetchExecutablePrices, forceRefreshBook },
    });

    expect(result.ok).toBe(true);
    expect(fetchExecutablePrices).toHaveBeenCalledTimes(2);
    expect(forceRefreshBook).toHaveBeenCalledTimes(1);
  });

  it('skips after exhausting retries', async () => {
    const fetchExecutablePrices = vi.fn().mockResolvedValue({
      executableBidVwap: 0.5,
      executableAskVwap: 0.6,
      liquidityStatus: 'partial',
      askLiquidityStatus: 'partial',
    });

    const result = await fetchEntryAskLiquidityWithRetries({
      assetId: 'asset-1',
      targetQty: 5,
      maxRetries: 2,
      delayMs: 0,
      connectionManager: { fetchExecutablePrices },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipReason).toContain('5 shares');
      expect(result.attempts).toBe(3);
    }
    expect(fetchExecutablePrices).toHaveBeenCalledTimes(3);
  });
});
