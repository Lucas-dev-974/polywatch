import { describe, expect, it } from 'vitest';
import type { WeatherConfig } from '@polywatch/core';
import { WEATHER_EXIT_DEFAULTS, resolveWeatherEntryExitParams } from '@polywatch/core';
import { WeatherExitManager } from './exit-manager.js';
import type { LedgerPosition } from './ledger.js';

function risk(overrides: Partial<WeatherConfig> = {}): WeatherConfig {
  return {
    weatherAlgoSlEnabled: true,
    weatherAlgoTpEnabled: true,
    weatherAlgoTrailingEnabled: true,
    weatherAlgoSlBidPoints: null,
    weatherAlgoTpBidPoints: null,
    weatherAlgoTrailingBidPoints: null,
    weatherAlgoTrailingActivationBidPoints: null,
    weatherAlgoForecastChangeThreshold: 2,
    weatherAlgoBucketHysteresisPolls: 2,
    weatherAlgoPollMs: 1_800_000,
    weatherAlgoReentryThrottleMs: 1_800_000,
    weatherAlgoCityFollowSwitchMode: 'close_and_reenter',
    ...overrides,
  } as unknown as WeatherConfig;
}

function pos(meta: Record<string, unknown> = {}): LedgerPosition {
  const resolved = resolveWeatherEntryExitParams(risk(), 'sim', null);
  return {
    conditionId: 'c1',
    city: 'london',
    targetDateIso: '2026-01-01',
    side: 'YES',
    qty: 10,
    entryPrice: 0.5,
    entryAt: new Date('2026-01-01T00:00:00Z'),
    markPrice: 0.5,
    peakBid: 0.5,
    fees: 0,
    entryReason: 'signal',
    meta: {
      strategyId: 'weather-forecast',
      entryMean: 12,
      entryBucketComparison: 'or_above',
      entryBucketBounds: { target: 12, low: null, high: null },
      slBidPoints: resolved.slBidPoints,
      tpBidPoints: resolved.tpBidPoints,
      trailingBidPoints: resolved.trailingBidPoints,
      trailingActivationBidPoints: resolved.trailingActivationBidPoints,
      ...meta,
    },
  };
}

describe('WeatherExitManager SL/TP defaults (B1)', () => {
  it('applies WEATHER_EXIT_DEFAULTS when bidPoints are null and flags true', () => {
    const mgr = new WeatherExitManager();
    const p = pos();
    expect(p.meta.slBidPoints).toBe(WEATHER_EXIT_DEFAULTS.slBidPoints);
    const sl = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.5 - WEATHER_EXIT_DEFAULTS.slBidPoints!,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(sl?.reason).toBe('SL');
  });

  it('disables SL when flag is false even if bidPoints set', () => {
    const cfg = risk({
      weatherAlgoStrategyParams: JSON.stringify({
        'weather-forecast': { slEnabled: false, slBidPoints: 0.05 },
      }),
    });
    const resolved = resolveWeatherEntryExitParams(cfg, 'sim', null, 'weather-forecast');
    expect(resolved.slBidPoints).toBeNull();
    const mgr = new WeatherExitManager();
    const p = pos({ slBidPoints: resolved.slBidPoints });
    const sl = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.1,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(sl).toBeNull();
  });
});

describe('WeatherExitManager re-entry throttle (B3)', () => {
  it('does not throttle after SL', () => {
    const mgr = new WeatherExitManager();
    const now = new Date('2026-01-01T01:00:00Z');
    mgr.evaluateSlTpTrailing(pos(), {
      yesPrice: 0.5 - WEATHER_EXIT_DEFAULTS.slBidPoints!,
      now,
      slippageBps: 0,
    });
    // evaluateSlTpTrailing no longer calls markClosed — throttle stays clear
    expect(mgr.isReentryBlocked('london', '2026-01-01', now, risk(), null)).toBe(false);
  });

  it('throttles after forecast drift exit', () => {
    const mgr = new WeatherExitManager();
    const now = new Date('2026-01-01T12:00:00Z');
    const decision = mgr.evaluate(pos(), {
      yesPrice: 0.5,
      currentMean: 20, // drifted from 12
      now,
      slippageBps: 0,
      entryMean: 12,
      entryBucketComparison: 'or_above',
      entryBucketBounds: { target: 12 },
      risk: risk(),
    });
    expect(decision?.reason).toBe('WEATHER_FORECAST_CHANGE');
    expect(mgr.isReentryBlocked('london', '2026-01-01', now, risk(), null)).toBe(true);
    expect(
      mgr.isReentryBlocked('london', '2026-01-01', new Date(now.getTime() + 1_800_000), risk(), null),
    ).toBe(false);
  });
});

describe('WeatherExitManager null-city throttle (T7)', () => {
  it('does not mark throttle for null-city position', () => {
    const mgr = new WeatherExitManager();
    const p = pos();
    p.city = null;
    const now = new Date('2026-01-01T12:00:00Z');
    const decision = mgr.evaluate(p, {
      yesPrice: 0.5,
      currentMean: 20, // drifted from 12
      now,
      slippageBps: 0,
      entryMean: 12,
      entryBucketComparison: 'or_above',
      entryBucketBounds: { target: 12 },
      risk: risk(),
    });
    expect(decision?.reason).toBe('WEATHER_FORECAST_CHANGE');
    expect(mgr.isReentryBlocked('', null, now, risk(), null)).toBe(false);
  });

  it('still throttles for city position (regression)', () => {
    const mgr = new WeatherExitManager();
    const now = new Date('2026-01-01T12:00:00Z');
    const decision = mgr.evaluate(pos(), {
      yesPrice: 0.5,
      currentMean: 20, // drifted from 12
      now,
      slippageBps: 0,
      entryMean: 12,
      entryBucketComparison: 'or_above',
      entryBucketBounds: { target: 12 },
      risk: risk(),
    });
    expect(decision?.reason).toBe('WEATHER_FORECAST_CHANGE');
    expect(mgr.isReentryBlocked('london', '2026-01-01', now, risk(), null)).toBe(true);
  });
});

describe('WeatherExitManager hysteresis poll window (F1)', () => {
  it('requires pollMs between hysteresis advances', () => {
    const cfg = risk({
      weatherAlgoStrategyParams: JSON.stringify({
        'weather-forecast': { bucketHysteresisPolls: 2 },
      }),
      weatherAlgoPollMs: 1_800_000,
    });
    const mgr = new WeatherExitManager();
    const base = new Date('2026-01-01T00:00:00Z');
    const input = {
      yesPrice: 0.5,
      currentMean: 11, // left or_above 12, but within drift threshold (2)
      slippageBps: 0,
      entryMean: 12,
      entryBucketComparison: 'or_above' as const,
      entryBucketBounds: { target: 12 },
      risk: cfg,
    };

    // First advance at t0 — consecutive=1, no exit yet
    expect(mgr.evaluate(pos(), { ...input, now: base })).toBeNull();
    // Same poll window — no second advance
    expect(
      mgr.evaluate(pos(), { ...input, now: new Date(base.getTime() + 60_000) }),
    ).toBeNull();
    // After pollMs — consecutive=2 → exit
    const exit = mgr.evaluate(pos(), {
      ...input,
      now: new Date(base.getTime() + 1_800_000),
    });
    expect(exit?.reason).toBe('WEATHER_BUCKET_EXIT');
  });
});
