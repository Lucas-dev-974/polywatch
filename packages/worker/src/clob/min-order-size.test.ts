import { MIN_ORDER_SHARES } from '@polywatch/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMinOrderSizeCache,
  resolveMinOrderShares,
  resolveMinOrderSharesDetailed,
} from './min-order-size.js';

describe('resolveMinOrderShares', () => {
  afterEach(() => {
    clearMinOrderSizeCache();
    vi.restoreAllMocks();
  });

  it('uses mos from getClobMarketInfo when available', async () => {
    const min = await resolveMinOrderShares({
      conditionId: 'cond-1',
      assetId: 'asset-1',
      getClobMarketInfo: async () => ({ mos: 5 }),
    });
    expect(min).toBe(5);
  });

  it('returns detailed source clob from getClobMarketInfo', async () => {
    const detailed = await resolveMinOrderSharesDetailed({
      conditionId: 'cond-1',
      assetId: 'asset-1',
      getClobMarketInfo: async () => ({ mos: 10 }),
    });
    expect(detailed).toEqual({ minShares: 10, source: 'clob' });
  });

  it('falls back to MIN_ORDER_SHARES when lookups fail', async () => {
    const min = await resolveMinOrderShares({
      conditionId: 'cond-2',
      assetId: 'asset-2',
      getClobMarketInfo: async () => {
        throw new Error('unavailable');
      },
    });
    expect(min).toBe(MIN_ORDER_SHARES);
  });

  it('returns fallback source when lookups fail', async () => {
    const detailed = await resolveMinOrderSharesDetailed({
      conditionId: 'cond-2',
      assetId: 'asset-2',
      getClobMarketInfo: async () => {
        throw new Error('unavailable');
      },
    });
    expect(detailed).toEqual({ minShares: MIN_ORDER_SHARES, source: 'fallback' });
  });
});
