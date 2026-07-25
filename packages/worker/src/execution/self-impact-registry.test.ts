import { describe, expect, it, beforeEach } from 'vitest';
import type { OrderBookLevel } from '@polywatch/core';
import { simulateFakFill } from '@polywatch/core';
import {
  SelfImpactRegistry,
  resetSelfImpactRegistryForTests,
} from './self-impact-registry.js';

const asks: OrderBookLevel[] = [
  { price: 0.5, size: 10 },
  { price: 0.52, size: 20 },
];

describe('SelfImpactRegistry', () => {
  beforeEach(() => {
    resetSelfImpactRegistryForTests();
  });

  it('records and consumes depth on the same asset', () => {
    const reg = new SelfImpactRegistry(8_000);
    reg.recordFill('token-a', 'BUY', asks, 10, 0.52);

    const adjusted = reg.applyImpact('token-a', 'BUY', asks);
    const second = simulateFakFill(adjusted, 15, 0.52, 'BUY');
    expect(second.fillQuantity).toBe(15);
    expect(adjusted.find((l) => l.price === 0.5)?.size ?? 0).toBe(0);
  });

  it('does not affect other assets', () => {
    const reg = new SelfImpactRegistry(8_000);
    reg.recordFill('token-a', 'BUY', asks, 10, 0.52);
    const adjusted = reg.applyImpact('token-b', 'BUY', asks);
    expect(adjusted).toEqual(asks);
  });
});
