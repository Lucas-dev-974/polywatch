import { describe, expect, it } from 'vitest';
import {
  FORCED_EXIT_CLOSE_REASONS,
  isForcedExitCloseReason,
  isForcedExitRetryableError,
} from './forced-exit.js';

describe('forced-exit helpers', () => {
  it('includes TP among tracked forced exit reasons', () => {
    expect(FORCED_EXIT_CLOSE_REASONS).toContain('TP');
  });

  it('detects forced exit close reasons', () => {
    expect(isForcedExitCloseReason('SL')).toBe(true);
    expect(isForcedExitCloseReason('TP')).toBe(true);
    expect(isForcedExitCloseReason('COPY_CLOSE')).toBe(false);
  });

  it('detects retryable forced exit errors', () => {
    expect(isForcedExitRetryableError('no_liquidity')).toBe(true);
    expect(isForcedExitRetryableError('position_already_closed')).toBe(false);
  });

  it('treats clob_rejected and its prefixed variants as retryable', () => {
    expect(isForcedExitRetryableError('clob_rejected')).toBe(true);
    expect(isForcedExitRetryableError('clob_rejected:INSUFFICIENT_BALANCE')).toBe(true);
    expect(isForcedExitRetryableError('clob_rejected:http 400: MINIMUM_ORDER_SIZE')).toBe(true);
    expect(isForcedExitRetryableError('clob_rejectedx')).toBe(false);
  });
});
