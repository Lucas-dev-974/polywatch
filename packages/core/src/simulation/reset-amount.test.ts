import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_BALANCE } from './constants.js';
import { resolveSimResetAmount } from '../services/simulation.service.js';

describe('resolveSimResetAmount', () => {
  it('uses requested amount when valid', () => {
    expect(resolveSimResetAmount(5000, 2000)).toBe(5000);
  });

  it('falls back to configured capital', () => {
    expect(resolveSimResetAmount(undefined, 2500)).toBe(2500);
  });

  it('falls back to default when nothing configured', () => {
    expect(resolveSimResetAmount(null, null)).toBe(DEFAULT_SIM_BALANCE);
  });

  it('ignores invalid requested amounts', () => {
    expect(resolveSimResetAmount(0, 3000)).toBe(3000);
    expect(resolveSimResetAmount('abc', 3000)).toBe(3000);
  });
});
