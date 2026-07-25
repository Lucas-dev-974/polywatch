import { describe, expect, it } from 'vitest';
import {
  formatPusdAmount,
  hasSufficientPusdBalance,
  parsePusdAmount,
  parsePusdAmountApi,
} from './pusd-amount.js';

describe('parsePusdAmount', () => {
  it('parses decimal strings with comma or dot', () => {
    expect(parsePusdAmount('10.5')).toBe(10_500_000n);
    expect(parsePusdAmount('10,50')).toBe(10_500_000n);
  });

  it('rejects invalid input', () => {
    expect(() => parsePusdAmount('')).toThrow('invalid_pusd_amount');
    expect(() => parsePusdAmount('abc')).toThrow('invalid_pusd_amount');
  });
});

describe('formatPusdAmount', () => {
  it('round-trips with parsePusdAmount', () => {
    const raw = parsePusdAmount('12.345678');
    expect(formatPusdAmount(raw)).toBe('12.345678');
  });
});

describe('parsePusdAmountApi', () => {
  it('accepts normalized strings', () => {
    expect(parsePusdAmountApi('10.50')).toBe(10.5);
  });

  it('accepts legacy numbers', () => {
    expect(parsePusdAmountApi(10.5)).toBe(10.5);
  });
});

describe('hasSufficientPusdBalance', () => {
  it('allows one micro-unit tolerance for float balance reads', () => {
    expect(hasSufficientPusdBalance(10, parsePusdAmount('10'))).toBe(true);
    expect(hasSufficientPusdBalance(10, parsePusdAmount('10.000001'))).toBe(true);
    expect(hasSufficientPusdBalance(10, parsePusdAmount('10.000002'))).toBe(false);
  });
});
