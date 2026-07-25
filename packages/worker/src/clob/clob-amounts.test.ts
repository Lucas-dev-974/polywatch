import { describe, expect, it } from 'vitest';
import {
  amountInterpretations,
  amountPairs,
  parseClobAmount,
  parseRawAmount,
} from './clob-amounts.js';

describe('parseRawAmount', () => {
  it('converts 6-decimal raw strings to human units', () => {
    expect(parseRawAmount('100000000')).toBe(100);
    expect(parseRawAmount('50000000')).toBe(50);
    expect(parseRawAmount('650000')).toBe(0.65);
  });

  it('returns 0 for invalid values', () => {
    expect(parseRawAmount('')).toBe(0);
    expect(parseRawAmount('abc')).toBe(0);
    expect(parseRawAmount('-1')).toBe(0);
  });
});

describe('parseClobAmount', () => {
  it('parses human decimals and raw integers', () => {
    expect(parseClobAmount('12.5')).toBe(12.5);
    expect(parseClobAmount('10000000')).toBe(10);
    expect(parseClobAmount('2.5')).toBe(2.5);
  });
});

describe('amountPairs', () => {
  it('does not mix human making with raw taking', () => {
    expect(amountPairs('1', '2.5')).toEqual([{ making: 1, taking: 2.5 }]);
  });

  it('includes raw pair when both sides have raw interpretations', () => {
    expect(amountPairs('100000000', '200000000')).toEqual([
      { making: 100000000, taking: 200000000 },
      { making: 100, taking: 200 },
    ]);
  });
});

describe('amountInterpretations', () => {
  it('returns human-only for decimal strings', () => {
    expect(amountInterpretations('2.5')).toEqual([2.5]);
  });
});
