import { describe, it, expect } from 'vitest';
import { parseWeatherQuestion } from './question-parser.js';

describe('parseWeatherQuestion', () => {
  it('parses "highest temperature in Hong Kong be 31°C on July 24"', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Hong Kong be 31°C on July 24?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Hong Kong');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(31);
    expect(result!.dateString).toBe('July 24');
    expect(result!.unit).toBe('celsius');
    expect(result!.comparison).toBe('exact');
    expect(result!.targetValueLow).toBeNull();
    expect(result!.targetValueHigh).toBeNull();
  });

  it('parses "lowest temperature" variant', () => {
    const result = parseWeatherQuestion(
      'Will the lowest temperature in London be 5°C on December 25?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('London');
    expect(result!.metric).toBe('lowest_temp');
    expect(result!.targetValue).toBe(5);
    expect(result!.unit).toBe('celsius');
    expect(result!.comparison).toBe('exact');
  });

  it('parses "or below" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Jinan be 15°C or below on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Jinan');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(15);
    expect(result!.comparison).toBe('or_below');
    expect(result!.unit).toBe('celsius');
  });

  it('parses °C "or higher" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Jinan be 25°C or higher on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Jinan');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(25);
    expect(result!.unit).toBe('celsius');
    expect(result!.comparison).toBe('or_above');
  });

  it('returns null for non-weather questions', () => {
    expect(parseWeatherQuestion('Will Bitcoin reach $100k?')).toBeNull();
    expect(parseWeatherQuestion('Will it rain in Tokyo?')).toBeNull();
  });

  it('parses °F "or below" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Seattle be 69°F or below on July 23?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Seattle');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeCloseTo(20.6, 0); // 69°F ≈ 20.56°C
    expect(result!.unit).toBe('fahrenheit');
    expect(result!.comparison).toBe('or_below');
    expect(result!.dateString).toBe('July 23');
  });

  it('parses °F "between" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Seattle be between 74-75°F on July 23?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Seattle');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeNull();
    expect(result!.targetValueLow).toBeCloseTo(23.3, 0); // 74°F ≈ 23.33°C
    expect(result!.targetValueHigh).toBeCloseTo(23.9, 0); // 75°F ≈ 23.89°C
    expect(result!.unit).toBe('fahrenheit');
    expect(result!.comparison).toBe('between');
    expect(result!.dateString).toBe('July 23');
  });

  it('parses °F "or higher" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Seattle be 88°F or higher on July 23?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Seattle');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeCloseTo(31.1, 0); // 88°F ≈ 31.11°C
    expect(result!.unit).toBe('fahrenheit');
    expect(result!.comparison).toBe('or_above');
  });

  it('parses °C "between" variant (future-proofing)', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Jinan be between 20-21°C on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Jinan');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBeNull();
    expect(result!.targetValueLow).toBe(20);
    expect(result!.targetValueHigh).toBe(21);
    expect(result!.comparison).toBe('between');
    expect(result!.unit).toBe('celsius');
  });

  it('parses fractional °C "or below" variant', () => {
    const result = parseWeatherQuestion(
      'Will the lowest temperature in Lyon be 12.5°C or below on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.metric).toBe('lowest_temp');
    expect(result!.targetValue).toBe(12.5);
    expect(result!.comparison).toBe('or_below');
  });

  it('parses negative fractional °C "between" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Lyon be between -5.5-10.5°C on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValueLow).toBe(-5.5);
    expect(result!.targetValueHigh).toBe(10.5);
    expect(result!.comparison).toBe('between');
  });
});