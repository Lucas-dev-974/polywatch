import { describe, expect, it } from 'vitest';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  clampCurveLookbackMs,
  DEFAULT_CRYPTO_ALGO_BASE_THRESHOLD,
  DEFAULT_CRYPTO_ALGO_CURVE_FILTER_ENABLED,
  DEFAULT_CRYPTO_ALGO_CURVE_LOOKBACK_MS,
  DEFAULT_CRYPTO_ALGO_CURVE_MIN_DELTA,
  DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_BAND_ENABLED,
  DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MAX,
  DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MIN,
  DEFAULT_CRYPTO_ALGO_GAMMA_CACHE_TTL_SHORT_MS,
  DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL,
  getCryptoAlgoSizingParams,
  mergeIntervalNumberMap,
  MAX_CRYPTO_ALGO_CURVE_LOOKBACK_MS,
  resolveGammaCacheTtlMs,
  resolveNaiveMomentumConfig,
  resolveSpreadAbsByInterval,
  validateCryptoAlgoTunablesUpdate,
} from './crypto-algo-tunables.js';

function makeRisk(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoBaseThreshold: null,
    cryptoAlgoSpreadAdjustmentFactor: null,
    cryptoAlgoMinSpreadAbsForAdjustment: null,
    cryptoAlgoMaxSpreadAbs: null,
    cryptoAlgoPriceSumTolerance: null,
    cryptoAlgoWarnPriceDeviation: null,
    cryptoAlgoMaxBookAgeMs: null,
    cryptoAlgoGammaCacheTtlShortMs: null,
    cryptoAlgoGammaCacheTtlDefaultMs: null,
    cryptoAlgoGammaStaleOnErrorFactor: null,
    cryptoAlgoWsDebounceMs: null,
    cryptoAlgoPollMs: null,
    cryptoAlgoTickIntervalMs: null,
    cryptoAlgoTickRetentionHours: null,
    cryptoAlgoPriceTickRefQty: null,
    cryptoAlgoMinTimeToCloseBufferSeconds: null,
    cryptoAlgoLastCloseableBidMaxAgeMs: null,
    cryptoAlgoSpreadAbsByInterval: null,
    cryptoAlgoExitDefaultsByInterval: null,
    cryptoAlgoPreCloseSecondsByInterval: null,
    cryptoAlgoEntryPriceMin: null,
    cryptoAlgoEntryPriceMax: null,
    cryptoAlgoEntryPriceBandEnabled: null,
    cryptoAlgoCurveFilterEnabled: null,
    cryptoAlgoCurveLookbackMs: null,
    cryptoAlgoCurveMinDelta: null,
    ...overrides,
  } as CryptoConfig;
}

describe('mergeIntervalNumberMap', () => {
  it('returns code defaults when override is null', () => {
    expect(mergeIntervalNumberMap(DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL, null)).toEqual(
      DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL,
    );
  });

  it('merges partial JSON override shallowly by interval', () => {
    const merged = mergeIntervalNumberMap(DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL, {
      '5m': 0.08,
    });
    expect(merged['5m']).toBe(0.08);
    expect(merged['1h']).toBe(0.02);
  });

  it('treats empty object as no override', () => {
    expect(
      mergeIntervalNumberMap(DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL, {}),
    ).toEqual(DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL);
  });
});

describe('resolveNaiveMomentumConfig', () => {
  it('uses code defaults when risk columns are null', () => {
    const cfg = resolveNaiveMomentumConfig(makeRisk());
    expect(cfg.baseThreshold).toBe(DEFAULT_CRYPTO_ALGO_BASE_THRESHOLD);
    expect(cfg.spreadAbsByInterval['5m']).toBe(0.05);
    expect(cfg.entryPriceBandEnabled).toBe(DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_BAND_ENABLED);
    expect(cfg.entryPriceMin).toBe(DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MIN);
    expect(cfg.entryPriceMax).toBe(DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MAX);
    expect(cfg.curveFilterEnabled).toBe(DEFAULT_CRYPTO_ALGO_CURVE_FILTER_ENABLED);
    expect(cfg.curveLookbackMs).toBe(DEFAULT_CRYPTO_ALGO_CURVE_LOOKBACK_MS);
    expect(cfg.curveMinDelta).toBe(DEFAULT_CRYPTO_ALGO_CURVE_MIN_DELTA);
  });

  it('clamps stale curve lookback above buffer max', () => {
    const cfg = resolveNaiveMomentumConfig(
      makeRisk({ cryptoAlgoCurveLookbackMs: 120_000 }),
    );
    expect(cfg.curveLookbackMs).toBe(MAX_CRYPTO_ALGO_CURVE_LOOKBACK_MS);
  });

  it('applies entry band overrides', () => {
    const cfg = resolveNaiveMomentumConfig(
      makeRisk({
        cryptoAlgoEntryPriceMin: 0.55,
        cryptoAlgoEntryPriceMax: 0.75,
        cryptoAlgoEntryPriceBandEnabled: false,
      }),
    );
    expect(cfg.entryPriceMin).toBe(0.55);
    expect(cfg.entryPriceMax).toBe(0.75);
    expect(cfg.entryPriceBandEnabled).toBe(false);
  });

  it('applies scalar threshold override', () => {
    const cfg = resolveNaiveMomentumConfig(
      makeRisk({ cryptoAlgoBaseThreshold: 0.6 }),
    );
    expect(cfg.baseThreshold).toBe(0.6);
  });
});

describe('resolveSpreadAbsByInterval', () => {
  it('uses merged table for known interval', () => {
    expect(
      resolveSpreadAbsByInterval(
        makeRisk({
          cryptoAlgoSpreadAbsByInterval: JSON.stringify({ '5m': 0.07 }),
        }),
        '5m',
      ),
    ).toBe(0.07);
  });

  it('falls back to maxSpreadAbs for unknown interval', () => {
    expect(
      resolveSpreadAbsByInterval(
        makeRisk({ cryptoAlgoMaxSpreadAbs: 0.03 }),
        'unknown',
      ),
    ).toBe(0.03);
  });
});

describe('resolveGammaCacheTtlMs', () => {
  it('uses short TTL for 5m when unset', () => {
    expect(resolveGammaCacheTtlMs(makeRisk(), '5m')).toBe(
      DEFAULT_CRYPTO_ALGO_GAMMA_CACHE_TTL_SHORT_MS,
    );
  });

  it('respects risk override for short intervals', () => {
    expect(
      resolveGammaCacheTtlMs(
        makeRisk({ cryptoAlgoGammaCacheTtlShortMs: 5_000 }),
        '5m',
      ),
    ).toBe(5_000);
  });
});

describe('clampCurveLookbackMs', () => {
  it('clamps above max and below min', () => {
    expect(clampCurveLookbackMs(120_000)).toBe(MAX_CRYPTO_ALGO_CURVE_LOOKBACK_MS);
    expect(clampCurveLookbackMs(500)).toBe(1_000);
    expect(clampCurveLookbackMs(15_000)).toBe(15_000);
  });
});

describe('validateCryptoAlgoTunablesUpdate', () => {
  it('accepts valid partial interval map', () => {
    expect(
      validateCryptoAlgoTunablesUpdate({
        cryptoAlgoSpreadAbsByInterval: { '5m': 0.04 },
      }),
    ).toEqual([]);
  });

  it('rejects invalid interval keys', () => {
    const errors = validateCryptoAlgoTunablesUpdate({
      cryptoAlgoSpreadAbsByInterval: { '2m': 0.04 },
    });
    expect(errors.some((e) => e.field.includes('2m'))).toBe(true);
  });

  it('rejects entry band min >= max', () => {
    const errors = validateCryptoAlgoTunablesUpdate({
      cryptoAlgoEntryPriceMin: 0.7,
      cryptoAlgoEntryPriceMax: 0.6,
    });
    expect(errors.some((e) => e.field === 'cryptoAlgoEntryPriceMax')).toBe(true);
  });

  it('accepts valid entry band bounds', () => {
    expect(
      validateCryptoAlgoTunablesUpdate({
        cryptoAlgoEntryPriceMin: 0.5,
        cryptoAlgoEntryPriceMax: 0.8,
        cryptoAlgoEntryPriceBandEnabled: true,
      }),
    ).toEqual([]);
  });

  it('rejects out-of-range threshold', () => {
    const errors = validateCryptoAlgoTunablesUpdate({
      cryptoAlgoBaseThreshold: 0.3,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid entry band enabled type', () => {
    const errors = validateCryptoAlgoTunablesUpdate({
      cryptoAlgoEntryPriceBandEnabled: 'yes',
    });
    expect(errors.some((e) => e.field === 'cryptoAlgoEntryPriceBandEnabled')).toBe(
      true,
    );
  });

  it('rejects curve lookback above buffer max', () => {
    const errors = validateCryptoAlgoTunablesUpdate({
      cryptoAlgoCurveLookbackMs: 120_000,
    });
    expect(errors.some((e) => e.field === 'cryptoAlgoCurveLookbackMs')).toBe(true);
  });

  it('rejects non-integer seconds in pre-close maps (C7.4)', () => {
    const errors = validateCryptoAlgoTunablesUpdate({
      cryptoAlgoPreCloseSecondsByInterval: { '5m': 90.7 },
    });
    expect(
      errors.some((e) => e.field.includes('cryptoAlgoPreCloseSecondsByInterval')),
    ).toBe(true);
  });

  it('accepts integer seconds maps', () => {
    expect(
      validateCryptoAlgoTunablesUpdate({
        cryptoAlgoPreCloseSecondsByInterval: { '5m': 90 },
      }),
    ).toEqual([]);
  });
});

describe('getCryptoAlgoSizingParams', () => {
  it('returns fixed_usdc params with defaults', () => {
    const params = getCryptoAlgoSizingParams(
      makeRisk({
        cryptoAlgoSizingMode: 'fixed_usdc',
        cryptoAlgoEntryUsdcAmount: 10,
        cryptoAlgoEntryShareCount: null,
      }),
    );
    expect(params.sizingMode).toBe('fixed_usdc');
    expect(params.copyRatio).toBe(0);
    expect(params.fixedUsdcAmount).toBe(10);
    expect(params.fixedShareCount).toBe(0);
    expect(params.kellyFraction).toBeUndefined();
    expect(params.riskBudgetUsdc).toBeUndefined();
    expect(params.defaultWinProbability).toBeUndefined();
    expect(params.signalScoreSizingEnabled).toBe(false);
  });

  it('returns fixed_shares params with share count', () => {
    const params = getCryptoAlgoSizingParams(
      makeRisk({
        cryptoAlgoSizingMode: 'fixed_shares',
        cryptoAlgoEntryUsdcAmount: 10,
        cryptoAlgoEntryShareCount: 3,
      }),
    );
    expect(params.sizingMode).toBe('fixed_shares');
    expect(params.fixedShareCount).toBe(3);
    expect(params.fixedUsdcAmount).toBe(10);
  });
});

/** Anti-drift snapshot: UI CODE_DEFAULT_* must stay equal to these core tables (C7.1). */
describe('code default tables (C7.1 anti-drift)', () => {
  it('spread abs table matches documented UI placeholders', () => {
    expect(DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL).toEqual({
      '5m': 0.05,
      '10m': 0.04,
      '15m': 0.03,
      '30m': 0.03,
      '1h': 0.02,
      '4h': 0.02,
      '1d': 0.02,
    });
  });
});
