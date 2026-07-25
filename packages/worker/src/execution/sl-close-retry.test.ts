import { describe, it, expect } from 'vitest';
import { effectiveCloseRetryAttempt } from '@polywatch/core';
import {
  FORCED_EXIT_REASONS,
  isForcedExitSignal,
  isSlCloseRetryableError,
} from './sl-close-retry.js';

describe('sl-close-retry', () => {
  it('considers only whitelisted errors retryable', () => {
    expect(isSlCloseRetryableError('no_liquidity')).toBe(true);
    expect(isSlCloseRetryableError('order_not_matched')).toBe(true);
    expect(isSlCloseRetryableError('tick_size_fetch_failed')).toBe(true);
    expect(isSlCloseRetryableError('slippage_exceeded')).toBe(false);
    expect(isSlCloseRetryableError(undefined)).toBe(false);
  });

  it('normalizes undefined attempt to 0', () => {
    expect(effectiveCloseRetryAttempt({} as any)).toBe(0);
  });

  it('returns explicit attempt count', () => {
    expect(effectiveCloseRetryAttempt({ closeRetryAttempt: 3 } as any)).toBe(3);
  });

  it('considers total SELL signals from forced-exit reasons retryable', () => {
    for (const reason of FORCED_EXIT_REASONS) {
      expect(
        isForcedExitSignal({ side: 'SELL', reason: reason as any }),
      ).toBe(true);
    }
    expect(isForcedExitSignal({ side: 'SELL', reason: 'TP' as any })).toBe(false);
    expect(isForcedExitSignal({ side: 'BUY', reason: 'SL' as any })).toBe(false);
  });
});
