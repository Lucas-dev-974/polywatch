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
});
