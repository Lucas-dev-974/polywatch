import { describe, it, expect } from 'vitest';
import type { OrderSignal } from '@polywatch/core';
import { failedExecution } from './execution-result.js';

function makeSignal(overrides: Partial<OrderSignal> = {}): OrderSignal {
  return {
    id: 'sig-1',
    copiedPositionId: 1,
    conditionId: '0xcond',
    assetId: '0xasset',
    side: 'SELL',
    quantity: 10,
    orderType: 'FAK',
    reason: 'SL',
    mode: 'sim',
    ...overrides,
  };
}

describe('failedExecution', () => {
  it('propagates reason and closeRetryAttempt so the forced-exit retry can gate on them', () => {
    const result = failedExecution(
      makeSignal({ reason: 'TIME_EXIT', closeRetryAttempt: 2 }),
      'no_liquidity',
    );
    expect(result.status).toBe('failed');
    expect(result.error).toBe('no_liquidity');
    expect(result.reason).toBe('TIME_EXIT');
    expect(result.closeRetryAttempt).toBe(2);
  });

  it('keeps fill fields zeroed', () => {
    const result = failedExecution(makeSignal(), 'order_not_matched');
    expect(result.fillPrice).toBe(0);
    expect(result.fillQuantity).toBe(0);
    expect(result.fees).toBe(0);
  });
});
