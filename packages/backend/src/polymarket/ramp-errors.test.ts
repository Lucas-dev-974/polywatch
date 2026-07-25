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

  it('rethrows unknown errors', () => {
    expect(() => mapRampExecutionError(new Error('relayer_no_tx_hash'))).toThrow(
      'relayer_no_tx_hash',
    );
  });
});
