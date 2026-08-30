import { describe, expect, it, vi } from 'vitest';
import type { OrderSignal } from '@polywatch/core';
import { simulateFakFill } from '@polywatch/core';

import { prepareFakMarketOrder } from './prepare-fak-order.js';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';

function baseSignal(overrides: Partial<OrderSignal> = {}): OrderSignal {
  return {
    id: 'sig-1',
    copiedPositionId: 1,
    conditionId: '0xcond',
    assetId: 'token-1',
    side: 'SELL',
    quantity: 10,
    orderType: 'FAK',
    reason: 'SL',
    mode: 'sim',
    referenceVwap: 0.5,
    ...overrides,
  };
}

function mockConnection(prices: {
  executableBidVwap: number;
  executableAskVwap: number;
}): PolymarketConnectionManager {
  return {
    fetchSellExecutablePrices: vi.fn().mockResolvedValue({
      ...prices,
      liquidityStatus: prices.executableBidVwap > 0 ? 'ok' : 'illiquid',
    }),
    fetchExecutablePrices: vi.fn().mockResolvedValue({
      ...prices,
      liquidityStatus: prices.executableAskVwap > 0 ? 'ok' : 'illiquid',
    }),
  } as unknown as PolymarketConnectionManager;
}

describe('prepareFakMarketOrder', () => {
  it('rejects with no_liquidity when VWAP is zero', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal(),
      mockConnection({ executableBidVwap: 0, executableAskVwap: 0 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.error).toBe('no_liquidity');
  });

  it('rejects slippage_exceeded for guarded reasons', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        reason: 'TP',
        referenceVwap: 0.5,
        side: 'SELL',
      }),
      mockConnection({ executableBidVwap: 0.4, executableAskVwap: 0.42 }),
      { getTickSize: async () => '0.01' as const },
    );
    // |0.4-0.5|/0.5 = 20% > default max 2%
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.error).toBe('slippage_exceeded');
  });

  it('lowers SELL limit to lastTradePrice when below bid VWAP', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        reason: 'SL',
        lastTradePrice: 0.4,
        referenceVwap: 0.5,
      }),
      mockConnection({ executableBidVwap: 0.5, executableAskVwap: 0.52 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepared.fillPrice).toBe(0.5);
      expect(result.prepared.usableFillPrice).toBe(0.4);
      expect(result.prepared.limitPrice).toBe(0.4);
      expect(result.prepared.entryBidVwap).toBe(0.5);
    }
  });

  it('ceils BUY FAK limit so the order is not posted below the ask', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.041,
        lastTradePrice: undefined,
      }),
      mockConnection({ executableBidVwap: 0.03, executableAskVwap: 0.041 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepared.fillPrice).toBe(0.041);
      expect(result.prepared.limitPrice).toBe(0.06);
    }
  });

  it('does not pad COPY_OPEN BUY beyond ceilToTick', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'COPY_OPEN',
        referenceVwap: 0.041,
        lastTradePrice: undefined,
      }),
      mockConnection({ executableBidVwap: 0.03, executableAskVwap: 0.041 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prepared.limitPrice).toBe(0.05);
  });

  it('allows a 1-tick WEATHER_OPEN BUY that exceeds a 7 % cap without tick floor', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.04,
        lastTradePrice: undefined,
      }),
      mockConnection({ executableBidVwap: 0.03, executableAskVwap: 0.05 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prepared.limitPrice).toBe(0.06);
  });

  it('applies a configurable entryTickPad of 2 ticks on WEATHER_OPEN BUY', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.041,
        lastTradePrice: undefined,
        entryTickPad: 2,
      }),
      mockConnection({ executableBidVwap: 0.03, executableAskVwap: 0.041 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prepared.limitPrice).toBe(0.07);
  });

  it('does not pad WEATHER_OPEN BUY when entryTickPad is 0', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.041,
        lastTradePrice: undefined,
        entryTickPad: 0,
      }),
      mockConnection({ executableBidVwap: 0.03, executableAskVwap: 0.041 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prepared.limitPrice).toBe(0.05);
  });

  it('clamps entryTickPad above 3 to 3 ticks', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.041,
        lastTradePrice: undefined,
        entryTickPad: 5,
      }),
      mockConnection({ executableBidVwap: 0.03, executableAskVwap: 0.041 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prepared.limitPrice).toBe(0.08);
  });

  it('still rejects WEATHER_OPEN BUY when the book jumped ~20 ticks', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.22,
        lastTradePrice: undefined,
      }),
      mockConnection({ executableBidVwap: 0.2, executableAskVwap: 0.42 }),
      { getTickSize: async () => '0.01' as const },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.error).toBe('slippage_exceeded');
  });

  it('requests a fresh book for WEATHER_OPEN BUY', async () => {
    const connection = mockConnection({
      executableBidVwap: 0.4,
      executableAskVwap: 0.5,
    });
    await prepareFakMarketOrder(
      baseSignal({
        side: 'BUY',
        reason: 'WEATHER_OPEN',
        referenceVwap: 0.5,
        lastTradePrice: undefined,
      }),
      connection,
      { getTickSize: async () => '0.01' as const },
    );
    expect(connection.fetchExecutablePrices).toHaveBeenCalledWith(
      'token-1',
      10,
      { maxAgeMs: 15_000 },
    );
  });

  it('rejects below_min_order_size for tiny SELL qty', async () => {
    const result = await prepareFakMarketOrder(
      baseSignal({ quantity: 0.01, reason: 'SL' }),
      mockConnection({ executableBidVwap: 0.5, executableAskVwap: 0.52 }),
      {
        getTickSize: async () => '0.01' as const,
        getClobMarketInfo: async () => ({ mos: 5 }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.error).toBe('below_min_order_size');
  });
});

describe('sim T1 FAK race (limit T0 vs book T1)', () => {
  it('returns zero fill when T1 book is empty → order_not_matched semantics', () => {
    const fak = simulateFakFill([], 10, 0.5, 'SELL');
    expect(fak.fillQuantity).toBe(0);
  });

  it('returns zero fill when T1 bids are all below SELL limit', () => {
    const fak = simulateFakFill(
      [
        { price: 0.3, size: 100 },
        { price: 0.35, size: 50 },
      ],
      10,
      0.5,
      'SELL',
    );
    expect(fak.fillQuantity).toBe(0);
  });

  it('partial fills when T1 depth is thin at limit', () => {
    const fak = simulateFakFill([{ price: 0.5, size: 4 }], 10, 0.5, 'SELL');
    expect(fak.fillQuantity).toBe(4);
    expect(fak.vwap).toBe(0.5);
  });
});
