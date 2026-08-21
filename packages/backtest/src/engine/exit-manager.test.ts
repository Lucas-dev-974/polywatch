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
    peakClosurePnl: 0,
    fees: 0,
    entryReason: 'signal',
    meta: {
      strategyId: 'weather-forecast',
      entryMean: 12,
      entryBucketComparison: 'or_above',
      entryBucketBounds: { target: 12, low: null, high: null },
      slPercent: resolved.slPercent,
      tpPercent: resolved.tpPercent,
      trailingPercent: resolved.trailingPercent,
      trailingActivationPercent: resolved.trailingActivationPercent,
      ...meta,
    },
  };
}

describe('WeatherExitManager SL/TP defaults (B1)', () => {
  it('applies WEATHER_EXIT_DEFAULTS when percents are null and flags true', () => {
    const mgr = new WeatherExitManager();
    const p = pos();
    expect(p.meta.slPercent).toBe(WEATHER_EXIT_DEFAULTS.slPercent);
    // cost basis = 0.5 (fees 0); SL at -20% => bid <= 0.4
    const sl = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.4,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(sl?.reason).toBe('SL');
  });

  it('disables SL when flag is false even if percent set', () => {
    const cfg = risk({
      weatherAlgoStrategyParams: JSON.stringify({
        'weather-forecast': { slEnabled: false, slPercent: 20 },
      }),
    });
    const resolved = resolveWeatherEntryExitParams(cfg, 'sim', null, 'weather-forecast');
    expect(resolved.slPercent).toBeNull();
    const mgr = new WeatherExitManager();
    const p = pos({ slPercent: resolved.slPercent });
    const sl = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.1,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(sl).toBeNull();
  });

  it('TP fires when closure PnL reaches tpPercent and trigger is positive', () => {
    const mgr = new WeatherExitManager();
    // entry 0.5, fees 0 => cost basis 0.5; TP at 25% => bid >= 0.625
    // trigger = (0.625 - 0.5) / 0.5 * 100 = 25% >= 0 ✓
    const p = pos({ slPercent: null, tpPercent: 25 });
    const tp = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.625,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(tp?.reason).toBe('TP');
  });

  it('TP does not fire when trigger is negative (market below entry)', () => {
    const mgr = new WeatherExitManager();
    // entry 0.5; bid 0.4 => closure -20% (below TP), trigger -20% < 0
    const p = pos({ slPercent: null, tpPercent: 25 });
    const tp = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.4,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(tp).toBeNull();
  });

  it('trailing fires on percentage drawdown from peak when armed', () => {
    const mgr = new WeatherExitManager();
    // entry 0.5, fees 0 => cost basis 0.5
    // peak closure 40% => peak bid = 0.7; current bid 0.65 => closure 30%
    // drawdown = 40 - 30 = 10% >= trailingPercent 10, armed (30 >= 12) => TRAILING
    const p = pos({
      slPercent: null,
      tpPercent: null,
      trailingPercent: 10,
      trailingActivationPercent: 12,
    });
    p.peakClosurePnl = 40;
    const trailing = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.65,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(trailing?.reason).toBe('TRAILING');
  });

  it('trailing does not fire when not armed (closure below activation)', () => {
    const mgr = new WeatherExitManager();
    // entry 0.5; bid 0.56 => closure 12%, peak 40%
    // armed requires closure >= 12 (boundary: 12 >= 12 - eps => true)
    // But drawdown = 40 - 12 = 28 >= 10, so it WOULD fire if armed.
    // Use bid 0.55 => closure 10% < 12 => not armed
    const p = pos({
      slPercent: null,
      tpPercent: null,
      trailingPercent: 10,
      trailingActivationPercent: 12,
    });
    p.peakClosurePnl = 40;
    const trailing = mgr.evaluateSlTpTrailing(p, {
      yesPrice: 0.55,
      now: new Date('2026-01-01T01:00:00Z'),
      slippageBps: 0,
    });
    expect(trailing).toBeNull();
  });
});

describe('WeatherExitManager re-entry throttle (B3)', () => {
  it('does not throttle after SL', () => {
    const mgr = new WeatherExitManager();
    const now = new Date('2026-01-01T01:00:00Z');
    mgr.evaluateSlTpTrailing(pos(), {
      yesPrice: 0.4, // -20% on cost basis 0.5 => SL
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
    expect(mgr.isReentryBlocked('london', '2026-01-01', now, risk(), 'weather-forecast')).toBe(true);
    expect(
      mgr.isReentryBlocked('london', '2026-01-01', new Date(now.getTime() + 1_800_000), risk(), 'weather-forecast'),
    ).toBe(false);
  });

  it('stratifies the re-entry throttle by strategyId (no cross-strategy interference)', () => {
    const mgr = new WeatherExitManager();
    const now = new Date('2026-01-01T12:00:00Z');
    // Close a position for strategy A (forecast drift).
    const decision = mgr.evaluate(
      pos({ strategyId: 'weather-forecast' }),
      {
        yesPrice: 0.5,
        currentMean: 20, // drifted from 12
        now,
        slippageBps: 0,
        entryMean: 12,
        entryBucketComparison: 'or_above',
        entryBucketBounds: { target: 12 },
        risk: risk(),
      },
    );
    expect(decision?.reason).toBe('WEATHER_FORECAST_CHANGE');

    // Strategy A is blocked on the same city/date.
    expect(
      mgr.isReentryBlocked('london', '2026-01-01', now, risk(), 'weather-forecast'),
    ).toBe(true);

    // A different strategy on the same city/date is NOT blocked.
    expect(
      mgr.isReentryBlocked('london', '2026-01-01', now, risk(), 'weather-forecast-aligned'),
    ).toBe(false);
  });

  it('marks the throttle on resolution via markClosed (P1-2)', () => {
    const mgr = new WeatherExitManager();
    const now = new Date('2026-01-01T12:00:00Z');
    mgr.markClosed('london', '2026-01-01', now, 'weather-forecast');
    expect(mgr.isReentryBlocked('london', '2026-01-01', now, risk(), 'weather-forecast')).toBe(true);
    // Another strategy remains unblocked.
    expect(
      mgr.isReentryBlocked('london', '2026-01-01', now, risk(), 'weather-forecast-aligned'),
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
    expect(mgr.isReentryBlocked('london', '2026-01-01', now, risk(), 'weather-forecast')).toBe(true);
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
