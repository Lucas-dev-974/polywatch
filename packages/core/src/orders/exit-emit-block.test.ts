import { describe, expect, it } from 'vitest';
import {
  isCriticalExitEmitBlock,
  isExitEmitBlockReason,
} from './exit-emit-block.js';

describe('exit-emit-block', () => {
  it('recognizes known block reasons', () => {
    expect(isExitEmitBlockReason('no_close_bid')).toBe(true);
    expect(isExitEmitBlockReason('forced_exit_cooldown')).toBe(true);
    expect(isExitEmitBlockReason('unknown')).toBe(false);
  });

  it('marks no_close_bid critical only for critical close reasons', () => {
    expect(isCriticalExitEmitBlock('no_close_bid', 'SL')).toBe(true);
    expect(isCriticalExitEmitBlock('no_close_bid', 'TP')).toBe(false);
    expect(isCriticalExitEmitBlock('no_close_bid', 'PRE_CLOSE_LOSS')).toBe(false);
  });

  it('never treats cooldown or SL confirmation as critical', () => {
    expect(isCriticalExitEmitBlock('forced_exit_cooldown', 'SL')).toBe(false);
    expect(isCriticalExitEmitBlock('sl_pending_confirmation', 'SL')).toBe(false);
    expect(isCriticalExitEmitBlock('in_flight_buy', 'SL')).toBe(false);
  });

  it('treats retries exhausted as always critical', () => {
    expect(isCriticalExitEmitBlock('forced_exit_retries_exhausted', 'TP')).toBe(
      true,
    );
  });
});
