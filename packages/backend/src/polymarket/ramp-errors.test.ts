import { describe, expect, it } from 'vitest';
import { mapRampExecutionError } from './ramp-errors.js';

describe('mapRampExecutionError', () => {
  it('maps OnlyUnpaused revert to offramp_paused', () => {
    expect(() => mapRampExecutionError(new Error('execution reverted: OnlyUnpaused()'))).toThrow(
      'offramp_paused',
    );
  });

  it('maps insufficient liquidity to offramp_insufficient_liquidity', () => {
    expect(() => mapRampExecutionError(new Error('insufficient balance'))).toThrow(
      'offramp_insufficient_liquidity',
    );
  });

  it('does not remap our insufficient_balance code', () => {
    expect(() => mapRampExecutionError(new Error('insufficient_balance'))).toThrow(
      'insufficient_balance',
    );
  });

  it('does not remap our insufficient_usdce_balance code', () => {
    expect(() => mapRampExecutionError(new Error('insufficient_usdce_balance'), 'wrap')).toThrow(
      'insufficient_usdce_balance',
    );
  });

  it('maps OnlyUnpaused revert to onramp_paused for wrap', () => {
    expect(() =>
      mapRampExecutionError(new Error('execution reverted: OnlyUnpaused()'), 'wrap'),
    ).toThrow('onramp_paused');
  });

  it('rethrows unknown errors', () => {
    expect(() => mapRampExecutionError(new Error('relayer_no_tx_hash'))).toThrow(
      'relayer_no_tx_hash',
    );
  });
});
