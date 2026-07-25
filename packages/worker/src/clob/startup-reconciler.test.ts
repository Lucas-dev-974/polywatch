import { ZERO_PLATFORM_FEE } from '@polywatch/core';
import { describe, expect, it } from 'vitest';
import {
  openOrderToFinalizeInput,
  pickMatchingTrade,
  tradeToFinalizeInput,
} from './startup-reconciler.js';

describe('pickMatchingTrade', () => {
  const trades = [
    {
      id: 't1',
      taker_order_id: 'o1',
      asset_id: 'asset-a',
      side: 'BUY',
      size: '100',
      price: '0.55',
      match_time: '1000',
    },
    {
      id: 't2',
      taker_order_id: 'o2',
      asset_id: 'asset-a',
      side: 'BUY',
      size: '50',
      price: '0.52',
      match_time: '2000',
    },
  ];

  it('returns the most recent trade matching asset, side and quantity', () => {
    expect(pickMatchingTrade(trades, 'asset-a', 'BUY', 100)).toMatchObject({ id: 't1' });
    expect(pickMatchingTrade(trades, 'asset-a', 'BUY', 50)).toMatchObject({ id: 't2' });
  });

  it('returns null when no trade matches', () => {
    expect(pickMatchingTrade(trades, 'asset-b', 'BUY', 100)).toBeNull();
    expect(pickMatchingTrade(trades, 'asset-a', 'SELL', 100)).toBeNull();
  });
});

describe('tradeToFinalizeInput', () => {
  it('builds finalize payload from trade', () => {
    const input = tradeToFinalizeInput(
      {
        id: 't1',
        taker_order_id: 'order-1',
        asset_id: 'a',
        side: 'BUY',
        size: '10',
        price: '0.5',
        match_time: '1',
      },
      'signal-1',
      ZERO_PLATFORM_FEE,
    );
    expect(input).toMatchObject({
      orderSignalId: 'signal-1',
      status: 'filled',
      fillQuantity: 10,
      fillPrice: 0.5,
      clobOrderId: 'order-1',
    });
  });
});

describe('openOrderToFinalizeInput', () => {
  it('returns null when size_matched is zero', () => {
    expect(
      openOrderToFinalizeInput(
        { id: 'o1', size_matched: '0', price: '0.5', status: 'live' },
        'signal-1',
        ZERO_PLATFORM_FEE,
      ),
    ).toBeNull();
  });

  it('parses raw matched size', () => {
    const input = openOrderToFinalizeInput(
      { id: 'o1', size_matched: '10000000', price: '0.5', status: 'matched' },
      'signal-1',
      ZERO_PLATFORM_FEE,
    );
    expect(input?.fillQuantity).toBe(10);
  });
});
