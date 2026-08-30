import { describe, expect, it } from 'vitest';
import {
  formatBucketLabel,
  isNeverOpenedCancelled,
  matchesWeatherPosMode,
  weatherHistoryCloseReasonLabel,
} from './weather-position';

describe('matchesWeatherPosMode', () => {
  it('Tous includes stored real and sim positions', () => {
    expect(matchesWeatherPosMode('real', 'all')).toBe(true);
    expect(matchesWeatherPosMode('sim', 'all')).toBe(true);
    expect(matchesWeatherPosMode('live', 'all')).toBe(true);
  });

  it('Live chip matches stored real (not sim)', () => {
    expect(matchesWeatherPosMode('real', 'live')).toBe(true);
    expect(matchesWeatherPosMode('live', 'live')).toBe(true);
    expect(matchesWeatherPosMode('sim', 'live')).toBe(false);
  });

  it('Sim chip matches only sim', () => {
    expect(matchesWeatherPosMode('sim', 'sim')).toBe(true);
    expect(matchesWeatherPosMode('real', 'sim')).toBe(false);
    expect(matchesWeatherPosMode('live', 'sim')).toBe(false);
  });
});

describe('formatBucketLabel fahrenheit display', () => {
  it('converts stored Celsius bounds back to °F for US cities', () => {
    expect(
      formatBucketLabel('between', { low: 38.9, high: 39.4 }, 'fahrenheit'),
    ).toBe('102°F – 102.9°F');
  });

  it('does not convert Celsius-labelled buckets', () => {
    expect(
      formatBucketLabel('between', { low: 38.9, high: 39.4 }, 'celsius'),
    ).toBe('38.9°C – 39.4°C');
  });

it('does not convert 102 F as if it were C (would be 215 F)', () => {
    expect(formatBucketLabel('exact', { target: 102 }, 'fahrenheit')).toBe('102°F');
  });

  it('does not convert numbers that already look like Fahrenheit', () => {
    expect(
      formatBucketLabel('between', { low: 102, high: 103 }, 'fahrenheit'),
    ).toBe('102°F – 103°F');
  });
});

describe('isNeverOpenedCancelled', () => {
  it('matches cancelled rows with no openedAt', () => {
    expect(isNeverOpenedCancelled({ status: 'cancelled', openedAt: null })).toBe(true);
    expect(isNeverOpenedCancelled({ status: 'cancelled' })).toBe(true);
  });

  it('does not match filled history rows', () => {
    expect(
      isNeverOpenedCancelled({ status: 'closed', openedAt: '2026-08-30T16:17:00.000Z' }),
    ).toBe(false);
    expect(
      isNeverOpenedCancelled({
        status: 'cancelled',
        openedAt: '2026-08-30T16:17:00.000Z',
      }),
    ).toBe(false);
  });
});

describe('weatherHistoryCloseReasonLabel', () => {
  it('maps no_liquidity instead of raw RESERVATION_RELEASED', () => {
    expect(weatherHistoryCloseReasonLabel('no_liquidity')).toBe('liquidité insuffisante');
    expect(weatherHistoryCloseReasonLabel('reservation_released')).toBe(
      'entrée jamais remplie (réservation libérée)',
    );
  });
});