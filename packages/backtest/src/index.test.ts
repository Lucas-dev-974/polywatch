import { describe, expect, it } from 'vitest';
import type { WeatherConfig } from '@polywatch/core';
import { applyConfigOverrides } from './index.js';

function baseConfig(): WeatherConfig {
  return {
    weatherAlgoEnabled: true,
    weatherAlgoMinEdge: 0.1,
    weatherAlgoSizingMode: 'fixed_usdc',
    weatherAlgoEntryUsdc: 10,
    weatherAlgoStrategyParams: '{}',
  } as unknown as WeatherConfig;
}

describe('applyConfigOverrides', () => {
  it('returns the config unchanged when no overrides', () => {
    const cfg = baseConfig();
    expect(applyConfigOverrides(cfg, undefined)).toBe(cfg);
    expect(applyConfigOverrides(cfg, {})).toBe(cfg);
  });

  it('applies valid weatherAlgo primitive overrides', () => {
    const cfg = baseConfig();
    const out = applyConfigOverrides(cfg, { weatherAlgoMinEdge: 0.25 });
    expect(out.weatherAlgoMinEdge).toBe(0.25);
    // Original object not mutated.
    expect(cfg.weatherAlgoMinEdge).toBe(0.1);
  });

  it('throws on unknown non-weatherAlgo keys', () => {
    expect(() =>
      applyConfigOverrides(baseConfig(), { foo: 'bar' }),
    ).toThrow(/clés inconnues/);
  });

  it('throws on non-primitive override values', () => {
    expect(() =>
      applyConfigOverrides(baseConfig(), { weatherAlgoSizingMode: ['fixed_usdc'] }),
    ).toThrow(/primitive/);
  });

  it('applies a valid weatherAlgoStrategyParams JSON override', () => {
    const cfg = baseConfig();
    const out = applyConfigOverrides(cfg, {
      weatherAlgoStrategyParams: JSON.stringify({ 'weather-forecast': { minEdge: 0.25 } }),
    });
    expect(out.weatherAlgoStrategyParams).toBe(
      JSON.stringify({ 'weather-forecast': { minEdge: 0.25 } }),
    );
  });

  it('throws on an invalid weatherAlgoStrategyParams override', () => {
    expect(() =>
      applyConfigOverrides(baseConfig(), {
        weatherAlgoStrategyParams: JSON.stringify({ 'weather-forecast': { minEdge: 'abc' } }),
      }),
    ).toThrow(/weatherAlgoStrategyParams invalide/);
  });

  it('throws on an out-of-bounds value in weatherAlgoStrategyParams override', () => {
    expect(() =>
      applyConfigOverrides(baseConfig(), {
        weatherAlgoStrategyParams: JSON.stringify({ 'weather-forecast': { minEdge: 0.9 } }),
      }),
    ).toThrow(/weatherAlgoStrategyParams invalide/);
  });
});
