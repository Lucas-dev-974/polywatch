import { describe, expect, it } from 'vitest';
import { isPollableTraderAddress } from './is-pollable-trader-address.js';

describe('isPollableTraderAddress', () => {
  it('accepts valid Ethereum addresses', () => {
    expect(
      isPollableTraderAddress('0x6af75d4e4aaf700450efbac3708cce1665810ff1'),
    ).toBe(true);
    expect(
      isPollableTraderAddress('0xABCDEF1234567890abcdef1234567890ABCDEF12'),
    ).toBe(true);
  });

  it('rejects algo sentinel addresses', () => {
    expect(isPollableTraderAddress('crypto-algo')).toBe(false);
    expect(isPollableTraderAddress('weather-algo')).toBe(false);
  });

  it('rejects malformed addresses', () => {
    expect(isPollableTraderAddress('')).toBe(false);
    expect(isPollableTraderAddress('0xshort')).toBe(false);
    expect(isPollableTraderAddress('not-an-address')).toBe(false);
  });
});
