import { ZERO_PLATFORM_FEE } from '@polywatch/core';
import { describe, expect, it } from 'vitest';
import {
  isActionableOrderUpdate,
  isActionableTradeEvent,
  isOrderCancellation,
  orderCancellationToFinalizeInput,
  orderEventToFinalizeInput,
  parseClobAmount,
  resolveClobOrderIdFromTrade,
  shouldPreferOrderUpdateForFill,
  tradeEventToFinalizeInput,
} from './ws-user-events.js';

describe('isActionableTradeEvent', () => {
  it('accepts MATCHED and CONFIRMED trades with positive size/price', () => {
    expect(
      isActionableTradeEvent({
        event_type: 'trade',
        status: 'MATCHED',
        size: '10',
        price: '0.55',
      }),
    ).toBe(true);
    expect(
      isActionableTradeEvent({
        event_type: 'trade',
        status: 'CONFIRMED',
        size: '5',
        price: '0.4',
      }),
    ).toBe(true);
  });

  it('rejects FAILED and zero-size trades', () => {
    expect(
      isActionableTradeEvent({
        event_type: 'trade',
        status: 'FAILED',
        size: '10',
        price: '0.55',
      }),
    ).toBe(false);
    expect(
      isActionableTradeEvent({
        event_type: 'trade',
        status: 'MATCHED',
        size: '0',
        price: '0.55',
      }),
    ).toBe(false);
  });
});

describe('order events', () => {
  it('detects cancellation', () => {
    expect(
      isOrderCancellation({ event_type: 'order', type: 'CANCELLATION', id: 'o1' }),
    ).toBe(true);
  });

  it('accepts UPDATE with matched size', () => {
    expect(
      isActionableOrderUpdate({
        event_type: 'order',
        type: 'UPDATE',
        size_matched: '10',
        price: '0.5',
      }),
    ).toBe(true);
  });

  it('parses raw matched size when value is large', () => {
    expect(parseClobAmount('10000000')).toBe(10);
    expect(parseClobAmount('12.5')).toBe(12.5);
  });

  it('builds finalize input from order update', () => {
    const input = orderEventToFinalizeInput(
      {
        event_type: 'order',
        id: 'order-abc',
        type: 'UPDATE',
        size_matched: '8',
        price: '0.62',
      },
      'signal-1',
      ZERO_PLATFORM_FEE,
    );
    expect(input).toMatchObject({
      orderSignalId: 'signal-1',
      status: 'filled',
      fillQuantity: 8,
      fillPrice: 0.62,
      clobOrderId: 'order-abc',
    });
  });

  it('computes partial delta from cumulative size_matched', () => {
    const input = orderEventToFinalizeInput(
      {
        event_type: 'order',
        id: 'order-partial',
        type: 'UPDATE',
        size_matched: '12',
        price: '0.5',
      },
      'signal-partial',
      ZERO_PLATFORM_FEE,
      7,
    );
    expect(input).toMatchObject({
      fillQuantity: 5,
      fillPrice: 0.5,
    });
  });

  it('builds cancelled finalize input', () => {
    expect(
      orderCancellationToFinalizeInput('signal-2', 'order-x'),
    ).toMatchObject({
      orderSignalId: 'signal-2',
      status: 'cancelled',
      clobOrderId: 'order-x',
      error: 'clob_order_cancelled',
    });
  });
});

describe('shouldPreferOrderUpdateForFill', () => {
  it('prefers order UPDATE while execution is in flight', () => {
    expect(shouldPreferOrderUpdateForFill('placing')).toBe(true);
    expect(shouldPreferOrderUpdateForFill('partial')).toBe(true);
    expect(shouldPreferOrderUpdateForFill('failed')).toBe(true);
    expect(shouldPreferOrderUpdateForFill('filled')).toBe(false);
  });
});

describe('tradeEventToFinalizeInput', () => {
  it('uses taker_order_id as clob order id', () => {
    const input = tradeEventToFinalizeInput(
      {
        event_type: 'trade',
        taker_order_id: 'taker-1',
        id: 'trade-1',
        size: '15',
        price: '0.48',
        status: 'MATCHED',
      },
      'signal-3',
      ZERO_PLATFORM_FEE,
    );
    expect(resolveClobOrderIdFromTrade({
      event_type: 'trade',
      taker_order_id: 'taker-1',
      id: 'trade-1',
    })).toBe('taker-1');
    expect(input).toMatchObject({
      orderSignalId: 'signal-3',
      fillQuantity: 15,
      fillPrice: 0.48,
      clobOrderId: 'taker-1',
    });
  });
});
