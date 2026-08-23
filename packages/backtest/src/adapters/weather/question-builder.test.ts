import { describe, expect, it } from 'vitest';
import { buildWeatherQuestion } from './question-builder.js';
import { parseWeatherQuestion } from '@polywatch/core';

describe('buildWeatherQuestion', () => {
  it('preserves fractional bucket target and re-parses it', () => {
    const q = buildWeatherQuestion({
      question: null,
      city: 'lyon',
      targetDateIso: '2026-01-02',
      metric: 'lowest_temp',
      bucketComparison: 'or_below',
      bucketTarget: 12.5,
      bucketLow: null,
      bucketHigh: null,
    });
    expect(q).toBe(
      'Will the lowest temperature in lyon be 12.5°C or below on 2026-01-02?',
    );
    const parsed = parseWeatherQuestion(q!);
    expect(parsed?.targetValue).toBe(12.5);
  });

  it('preserves fractional between bounds with a negative low', () => {
    const q = buildWeatherQuestion({
      question: null,
      city: 'lyon',
      targetDateIso: '2026-01-02',
      metric: 'highest_temp',
      bucketComparison: 'between',
      bucketTarget: null,
      bucketLow: -5.5,
      bucketHigh: 10.5,
    });
    expect(q).toBe(
      'Will the highest temperature in lyon be between -5.5-10.5°C on 2026-01-02?',
    );
    const parsed = parseWeatherQuestion(q!);
    expect(parsed?.targetValueLow).toBe(-5.5);
    expect(parsed?.targetValueHigh).toBe(10.5);
  });

  it('formats integer targets without trailing decimal', () => {
    const q = buildWeatherQuestion({
      question: null,
      city: 'lyon',
      targetDateIso: '2026-01-02',
      metric: 'highest_temp',
      bucketComparison: 'or_above',
      bucketTarget: 12,
      bucketLow: null,
      bucketHigh: null,
    });
    expect(q).toBe(
      'Will the highest temperature in lyon be 12°C or above on 2026-01-02?',
    );
  });
});
