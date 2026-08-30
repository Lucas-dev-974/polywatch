import { describe, expect, it } from 'vitest';
import {
  RESERVATION_CLOSE_REASON_RELEASED,
  closeReasonFromFailedBuy,
  isNeverOpenedCancelled,
} from './reservation-close-reasons.js';

describe('closeReasonFromFailedBuy', () => {
  it('uses the execution error code when present', () => {
    expect(closeReasonFromFailedBuy('no_liquidity')).toBe('no_liquidity');
    expect(closeReasonFromFailedBuy('order_not_matched')).toBe('order_not_matched');
    expect(closeReasonFromFailedBuy('slippage_exceeded: 4.2%')).toBe('slippage_exceeded');
  });

  it('falls back to reservation_released without a usable code', () => {
    expect(closeReasonFromFailedBuy(null)).toBe(RESERVATION_CLOSE_REASON_RELEASED);
    expect(closeReasonFromFailedBuy(undefined)).toBe(RESERVATION_CLOSE_REASON_RELEASED);
    expect(closeReasonFromFailedBuy('')).toBe(RESERVATION_CLOSE_REASON_RELEASED);
    expect(closeReasonFromFailedBuy('x'.repeat(80))).toBe(RESERVATION_CLOSE_REASON_RELEASED);
  });
});

describe('isNeverOpenedCancelled', () => {
  it('matches cancelled rows that never received a fill', () => {
    expect(isNeverOpenedCancelled({ status: 'cancelled', openedAt: null })).toBe(true);
    expect(isNeverOpenedCancelled({ status: 'cancelled' })).toBe(true);
  });

  it('does not match filled-then-closed or still-open rows', () => {
    expect(
      isNeverOpenedCancelled({ status: 'closed', openedAt: new Date() }),
    ).toBe(false);
    expect(
      isNeverOpenedCancelled({
        status: 'cancelled',
        openedAt: '2026-08-30T16:17:00.000Z',
      }),
    ).toBe(false);
    expect(isNeverOpenedCancelled({ status: 'open', openedAt: null })).toBe(false);
  });
});