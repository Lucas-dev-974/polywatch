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
});
