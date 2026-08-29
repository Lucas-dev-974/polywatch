import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  CRYPTO_INTERVAL_EXIT_DEFAULTS,
  CRYPTO_INTERVAL_PRE_CLOSE_SECONDS,
  normalizeCryptoInterval,
} from './crypto-algo-exit.js';
import type { ModeSizingParams } from './policy.js';

/** Valid crypto market intervals (mirrors crypto-algo strategy constants). */
export const CRYPTO_ALGO_VALID_INTERVALS = [
  '5m',
  '10m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
] as const;

export type CryptoAlgoValidInterval = (typeof CRYPTO_ALGO_VALID_INTERVALS)[number];

const INTERVAL_ALIASES: Readonly<Record<string, CryptoAlgoValidInterval>> = {
  '5min': '5m',
  '10min': '10m',
  '15min': '15m',
  '30min': '30m',
  '1hour': '1h',
  '4hour': '4h',
  '1day': '1d',
};

/** Code defaults — naive-momentum strategy. */
export const DEFAULT_CRYPTO_ALGO_BASE_THRESHOLD = 0.55;
export const DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MIN = 0.55;
export const DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MAX = 0.8;
export const DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_BAND_ENABLED = true;
export const DEFAULT_CRYPTO_ALGO_CURVE_FILTER_ENABLED = false;
export const DEFAULT_CRYPTO_ALGO_CURVE_LOOKBACK_MS = 10_000;
export const MIN_CRYPTO_ALGO_CURVE_LOOKBACK_MS = 1_000;
export const MAX_CRYPTO_ALGO_CURVE_LOOKBACK_MS = 60_000;
export const DEFAULT_CRYPTO_ALGO_CURVE_MIN_DELTA = 0.01;
export const DEFAULT_CRYPTO_ALGO_MAX_SPREAD_ABS = 0.02;
export const DEFAULT_CRYPTO_ALGO_SPREAD_ADJUSTMENT_FACTOR = 0.5;
export const DEFAULT_CRYPTO_ALGO_MIN_SPREAD_ABS_FOR_ADJUSTMENT = 0.01;
export const DEFAULT_CRYPTO_ALGO_PRICE_SUM_TOLERANCE = 0.02;
export const DEFAULT_CRYPTO_ALGO_WARN_PRICE_DEVIATION = 0.05;
export const DEFAULT_CRYPTO_ALGO_MAX_BOOK_AGE_MS = 15_000;

/** Code defaults — timing / freshness. */
export const DEFAULT_CRYPTO_ALGO_GAMMA_CACHE_TTL_SHORT_MS = 10_000;
export const DEFAULT_CRYPTO_ALGO_GAMMA_CACHE_TTL_DEFAULT_MS = 30_000;
export const DEFAULT_CRYPTO_ALGO_GAMMA_STALE_ON_ERROR_FACTOR = 2;
export const DEFAULT_CRYPTO_ALGO_WS_DEBOUNCE_MS = 5_000;
export const DEFAULT_CRYPTO_ALGO_POLL_MS = 30_000;
export const DEFAULT_CRYPTO_ALGO_TICK_INTERVAL_MS = 1_000;
export const DEFAULT_CRYPTO_ALGO_TICK_RETENTION_HOURS = 24;
export const DEFAULT_CRYPTO_ALGO_PRICE_TICK_REF_QTY = 50;
export const DEFAULT_CRYPTO_ALGO_MIN_TIME_TO_CLOSE_BUFFER_SECONDS = 30;
export const DEFAULT_CRYPTO_ALGO_LAST_CLOSEABLE_BID_MAX_AGE_MS = 60_000;

/** Code defaults — SL quota. */
export const DEFAULT_CRYPTO_ALGO_SL_QUOTA_ENABLED = false;
export const DEFAULT_CRYPTO_ALGO_SL_QUOTA_PER_MARKET = 1;
export const DEFAULT_CRYPTO_ALGO_SL_QUOTA_CACHE_TTL_SECONDS = 30;

/** Code defaults — spread abs by interval. */
export const DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL: Readonly<
  Record<CryptoAlgoValidInterval, number>
> = {
  '5m': 0.05,
  '10m': 0.04,
  '15m': 0.03,
  '30m': 0.03,
  '1h': 0.02,
  '4h': 0.02,
  '1d': 0.02,
};

export interface CryptoAlgoIntervalExitDefaults extends Record<string, unknown> {
  slPercent?: number;
  tpPercent?: number;
  trailingPercent?: number;
  trailingActivationPercent?: number;
}

export type CryptoAlgoNumberIntervalMap = Partial<
  Record<CryptoAlgoValidInterval, number>
>;
export type CryptoAlgoExitDefaultsIntervalMap = Partial<
  Record<CryptoAlgoValidInterval, CryptoAlgoIntervalExitDefaults>
>;

export interface NaiveMomentumTunables {
  baseThreshold: number;
  maxSpreadAbs: number;
  spreadAdjustmentFactor: number;
  minSpreadAbsForAdjustment: number;
  priceSumTolerance: number;
  warnPriceDeviation: number;
  maxBookAgeMs: number;
  spreadAbsByInterval: Record<CryptoAlgoValidInterval, number>;
  entryPriceBandEnabled: boolean;
  entryPriceMin: number;
  entryPriceMax: number;
  curveFilterEnabled: boolean;
  curveLookbackMs: number;
  curveMinDelta: number;
}

export function normalizeCryptoAlgoInterval(
  interval: string | null | undefined,
): CryptoAlgoValidInterval | null {
  if (!interval) return null;
  const normalized = INTERVAL_ALIASES[interval] ?? interval;
  return CRYPTO_ALGO_VALID_INTERVALS.includes(normalized as CryptoAlgoValidInterval)
    ? (normalized as CryptoAlgoValidInterval)
    : normalizeCryptoInterval(interval) as CryptoAlgoValidInterval | null;
}

export function parseCryptoAlgoIntervalJsonMap<T extends Record<string, unknown>>(
  json: string | null | undefined,
): Partial<Record<CryptoAlgoValidInterval, T>> | null {
  if (!json || json.trim() === '') return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const out: Partial<Record<CryptoAlgoValidInterval, T>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeCryptoAlgoInterval(key);
      if (!normalized) continue;
      if (value != null && typeof value === 'object') {
        out[normalized] = value as T;
      }
    }
    return Object.keys(out).length > 0 ? out : {};
  } catch {
    return null;
  }
}

export function parseCryptoAlgoIntervalNumberMap(
  json: string | null | undefined,
): CryptoAlgoNumberIntervalMap | null {
  if (!json || json.trim() === '') return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const out: CryptoAlgoNumberIntervalMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normalized = normalizeCryptoAlgoInterval(key);
      if (!normalized) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[normalized] = value;
      }
    }
    return Object.keys(out).length > 0 ? out : {};
  } catch {
    return null;
  }
}

export function mergeIntervalNumberMap(
  defaults: Readonly<Record<CryptoAlgoValidInterval, number>>,
  override: CryptoAlgoNumberIntervalMap | null | undefined,
): Record<CryptoAlgoValidInterval, number> {
  if (!override || Object.keys(override).length === 0) {
    return { ...defaults };
  }
  return { ...defaults, ...override };
}

function positiveThreshold(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Normalize a per-interval exit-defaults object to percent fields.
 * Legacy `*BidPoints` keys (absolute [0,1] distance) are converted ×100
 * when the matching `*Percent` field is absent.
 */
export function normalizeCryptoAlgoIntervalExitDefaults(
  entry: Record<string, unknown>,
): CryptoAlgoIntervalExitDefaults {
  const pick = (percentKey: string, bidKey: string): number | undefined => {
    const percent = positiveThreshold(entry[percentKey]);
    if (percent != null) return percent;
    const bid = positiveThreshold(entry[bidKey]);
    if (bid != null) return bid * 100;
    return undefined;
  };
  const out: CryptoAlgoIntervalExitDefaults = {};
  const sl = pick('slPercent', 'slBidPoints');
  const tp = pick('tpPercent', 'tpBidPoints');
  const trailing = pick('trailingPercent', 'trailingBidPoints');
  const activation = pick(
    'trailingActivationPercent',
    'trailingActivationBidPoints',
  );
  if (sl != null) out.slPercent = sl;
  if (tp != null) out.tpPercent = tp;
  if (trailing != null) out.trailingPercent = trailing;
  if (activation != null) out.trailingActivationPercent = activation;
  return out;
}

export function mergeIntervalExitDefaults(
  defaults: Readonly<Record<string, CryptoAlgoIntervalExitDefaults>>,
  override: CryptoAlgoExitDefaultsIntervalMap | null | undefined,
): Record<string, CryptoAlgoIntervalExitDefaults> {
  if (!override || Object.keys(override).length === 0) {
    return { ...defaults };
  }
  const merged: Record<string, CryptoAlgoIntervalExitDefaults> = { ...defaults };
  for (const [interval, partial] of Object.entries(override)) {
    const base = merged[interval];
    if (!base || !partial) continue;
    merged[interval] = {
      ...base,
      ...normalizeCryptoAlgoIntervalExitDefaults(
        partial as Record<string, unknown>,
      ),
    };
  }
  return merged;
}

export function serializeCryptoAlgoIntervalJsonMap(
  value: CryptoAlgoNumberIntervalMap | CryptoAlgoExitDefaultsIntervalMap | null | undefined,
): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

export function resolveNaiveMomentumConfig(risk: CryptoConfig): NaiveMomentumTunables {
  const spreadOverride = parseCryptoAlgoIntervalNumberMap(
    risk.cryptoAlgoSpreadAbsByInterval,
  );

  return {
    baseThreshold:
      risk.cryptoAlgoBaseThreshold ?? DEFAULT_CRYPTO_ALGO_BASE_THRESHOLD,
    maxSpreadAbs:
      risk.cryptoAlgoMaxSpreadAbs ?? DEFAULT_CRYPTO_ALGO_MAX_SPREAD_ABS,
    spreadAdjustmentFactor:
      risk.cryptoAlgoSpreadAdjustmentFactor ??
      DEFAULT_CRYPTO_ALGO_SPREAD_ADJUSTMENT_FACTOR,
    minSpreadAbsForAdjustment:
      risk.cryptoAlgoMinSpreadAbsForAdjustment ??
      DEFAULT_CRYPTO_ALGO_MIN_SPREAD_ABS_FOR_ADJUSTMENT,
    priceSumTolerance:
      risk.cryptoAlgoPriceSumTolerance ?? DEFAULT_CRYPTO_ALGO_PRICE_SUM_TOLERANCE,
    warnPriceDeviation:
      risk.cryptoAlgoWarnPriceDeviation ?? DEFAULT_CRYPTO_ALGO_WARN_PRICE_DEVIATION,
    maxBookAgeMs:
      risk.cryptoAlgoMaxBookAgeMs ?? DEFAULT_CRYPTO_ALGO_MAX_BOOK_AGE_MS,
    spreadAbsByInterval: mergeIntervalNumberMap(
      DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL,
      spreadOverride,
    ),
    entryPriceBandEnabled:
      risk.cryptoAlgoEntryPriceBandEnabled ??
      DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_BAND_ENABLED,
    entryPriceMin:
      risk.cryptoAlgoEntryPriceMin ?? DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MIN,
    entryPriceMax:
      risk.cryptoAlgoEntryPriceMax ?? DEFAULT_CRYPTO_ALGO_ENTRY_PRICE_MAX,
    curveFilterEnabled:
      risk.cryptoAlgoCurveFilterEnabled ?? DEFAULT_CRYPTO_ALGO_CURVE_FILTER_ENABLED,
    curveLookbackMs: clampCurveLookbackMs(
      risk.cryptoAlgoCurveLookbackMs ?? DEFAULT_CRYPTO_ALGO_CURVE_LOOKBACK_MS,
    ),
    curveMinDelta:
      risk.cryptoAlgoCurveMinDelta ?? DEFAULT_CRYPTO_ALGO_CURVE_MIN_DELTA,
  };
}

/** Clamp stale DB values to buffer capacity (CURVE_BUFFER_MAX_MS = 60s). */
export function clampCurveLookbackMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CRYPTO_ALGO_CURVE_LOOKBACK_MS;
  }
  return Math.min(
    MAX_CRYPTO_ALGO_CURVE_LOOKBACK_MS,
    Math.max(MIN_CRYPTO_ALGO_CURVE_LOOKBACK_MS, Math.trunc(value)),
  );
}

export function resolveSpreadAbsByInterval(
  risk: CryptoConfig,
  interval: string | null | undefined,
): number {
  const tunables = resolveNaiveMomentumConfig(risk);
  const normalized = normalizeCryptoAlgoInterval(interval);
  if (normalized) {
    return tunables.spreadAbsByInterval[normalized];
  }
  return tunables.maxSpreadAbs;
}

export function resolveExitDefaultsByInterval(
  risk: CryptoConfig,
  interval: string | null | undefined,
): CryptoAlgoIntervalExitDefaults | undefined {
  const normalized = normalizeCryptoAlgoInterval(interval);
  if (!normalized) return undefined;

  const override = parseCryptoAlgoIntervalJsonMap<CryptoAlgoIntervalExitDefaults>(
    risk.cryptoAlgoExitDefaultsByInterval,
  );
  const merged = mergeIntervalExitDefaults(
    CRYPTO_INTERVAL_EXIT_DEFAULTS as Record<string, CryptoAlgoIntervalExitDefaults>,
    override,
  );
  return merged[normalized];
}

export function resolvePreCloseSecondsByInterval(
  risk: CryptoConfig,
  interval: string | null | undefined,
): number | undefined {
  const normalized = normalizeCryptoAlgoInterval(interval);
  if (!normalized) return undefined;

  const override = parseCryptoAlgoIntervalNumberMap(
    risk.cryptoAlgoPreCloseSecondsByInterval,
  );
  const merged = mergeIntervalNumberMap(
    CRYPTO_INTERVAL_PRE_CLOSE_SECONDS as Record<CryptoAlgoValidInterval, number>,
    override,
  );
  return merged[normalized];
}

const SHORT_GAMMA_INTERVALS: ReadonlySet<CryptoAlgoValidInterval> = new Set([
  '5m',
  '10m',
  '15m',
]);

export function resolveGammaCacheTtlMs(
  risk: CryptoConfig,
  interval: string | null | undefined,
): number {
  const normalized = normalizeCryptoAlgoInterval(interval);
  if (
    normalized &&
    SHORT_GAMMA_INTERVALS.has(normalized)
  ) {
    return (
      risk.cryptoAlgoGammaCacheTtlShortMs ??
      DEFAULT_CRYPTO_ALGO_GAMMA_CACHE_TTL_SHORT_MS
    );
  }
  return (
    risk.cryptoAlgoGammaCacheTtlDefaultMs ??
    DEFAULT_CRYPTO_ALGO_GAMMA_CACHE_TTL_DEFAULT_MS
  );
}

export function resolveGammaStaleOnErrorFactor(risk: CryptoConfig): number {
  return (
    risk.cryptoAlgoGammaStaleOnErrorFactor ??
    DEFAULT_CRYPTO_ALGO_GAMMA_STALE_ON_ERROR_FACTOR
  );
}

export function resolveWsDebounceMs(risk: CryptoConfig): number {
  return risk.cryptoAlgoWsDebounceMs ?? DEFAULT_CRYPTO_ALGO_WS_DEBOUNCE_MS;
}

export function resolveMaxBookAgeMs(risk: CryptoConfig): number {
  return risk.cryptoAlgoMaxBookAgeMs ?? DEFAULT_CRYPTO_ALGO_MAX_BOOK_AGE_MS;
}

export function resolvePollMs(
  risk: CryptoConfig,
  envFallback = DEFAULT_CRYPTO_ALGO_POLL_MS,
): number {
  return risk.cryptoAlgoPollMs ?? envFallback;
}

export function resolveTickIntervalMs(risk: CryptoConfig): number {
  return risk.cryptoAlgoTickIntervalMs ?? DEFAULT_CRYPTO_ALGO_TICK_INTERVAL_MS;
}

export function resolveTickRetentionHours(risk: CryptoConfig): number {
  return (
    risk.cryptoAlgoTickRetentionHours ?? DEFAULT_CRYPTO_ALGO_TICK_RETENTION_HOURS
  );
}

export function resolvePriceTickRefQty(risk: CryptoConfig): number {
  return risk.cryptoAlgoPriceTickRefQty ?? DEFAULT_CRYPTO_ALGO_PRICE_TICK_REF_QTY;
}

export function resolveMinTimeToCloseBufferSeconds(risk: CryptoConfig): number {
  return (
    risk.cryptoAlgoMinTimeToCloseBufferSeconds ??
    DEFAULT_CRYPTO_ALGO_MIN_TIME_TO_CLOSE_BUFFER_SECONDS
  );
}

export function resolveLastCloseableBidMaxAgeMs(risk: CryptoConfig): number {
  return (
    risk.cryptoAlgoLastCloseableBidMaxAgeMs ??
    DEFAULT_CRYPTO_ALGO_LAST_CLOSEABLE_BID_MAX_AGE_MS
  );
}

export function resolveSlQuotaEnabled(risk: CryptoConfig): boolean {
  return risk.cryptoAlgoSlQuotaEnabled ?? DEFAULT_CRYPTO_ALGO_SL_QUOTA_ENABLED;
}

export function resolveSlQuotaPerMarket(risk: CryptoConfig): number {
  return risk.cryptoAlgoSlQuotaPerMarket ?? DEFAULT_CRYPTO_ALGO_SL_QUOTA_PER_MARKET;
}

export function resolveSlQuotaCacheTtlSeconds(risk: CryptoConfig): number {
  return risk.cryptoAlgoSlQuotaCacheTtlSeconds ?? DEFAULT_CRYPTO_ALGO_SL_QUOTA_CACHE_TTL_SECONDS;
}

export function getCryptoAlgoSizingParams(risk: CryptoConfig): ModeSizingParams {
  return {
    sizingMode: risk.cryptoAlgoSizingMode as import('../types/index.js').SizingMode,
    copyRatio: 0,
    fixedPusdAmount: risk.cryptoAlgoEntryPusdAmount,
    fixedShareCount: risk.cryptoAlgoEntryShareCount ?? 0,
    kellyFraction: undefined,
    riskBudgetPusd: undefined,
    defaultWinProbability: undefined,
    signalScoreSizingEnabled: false,
  };
}

export interface CryptoAlgoTunablesValidationError {
  field: string;
  message: string;
}

function isValidIntervalKey(key: string): key is CryptoAlgoValidInterval {
  return (CRYPTO_ALGO_VALID_INTERVALS as readonly string[]).includes(key);
}

/** Validate interval JSON maps and scalar tunables before PATCH. */
export function validateCryptoAlgoTunablesUpdate(
  data: Record<string, unknown>,
): CryptoAlgoTunablesValidationError[] {
  const errors: CryptoAlgoTunablesValidationError[] = [];

  const checkPositiveInt = (
    field: string,
    value: unknown,
    min: number,
    max: number,
  ) => {
    if (value == null) return;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      errors.push({
        field,
        message: `must be an integer between ${min} and ${max}`,
      });
    }
  };

  const checkPositiveReal = (
    field: string,
    value: unknown,
    min: number,
    max: number,
  ) => {
    if (value == null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      errors.push({
        field,
        message: `must be a number between ${min} and ${max}`,
      });
    }
  };

  checkPositiveReal('cryptoAlgoBaseThreshold', data.cryptoAlgoBaseThreshold, 0.5, 0.99);
  checkPositiveReal(
    'cryptoAlgoEntryPriceMin',
    data.cryptoAlgoEntryPriceMin,
    0.01,
    0.98,
  );
  checkPositiveReal(
    'cryptoAlgoEntryPriceMax',
    data.cryptoAlgoEntryPriceMax,
    0.02,
    0.99,
  );
  if (
    data.cryptoAlgoEntryPriceMin != null &&
    data.cryptoAlgoEntryPriceMax != null &&
    typeof data.cryptoAlgoEntryPriceMin === 'number' &&
    typeof data.cryptoAlgoEntryPriceMax === 'number' &&
    Number.isFinite(data.cryptoAlgoEntryPriceMin) &&
    Number.isFinite(data.cryptoAlgoEntryPriceMax) &&
    data.cryptoAlgoEntryPriceMin >= data.cryptoAlgoEntryPriceMax
  ) {
    errors.push({
      field: 'cryptoAlgoEntryPriceMax',
      message: 'must be greater than cryptoAlgoEntryPriceMin',
    });
  }
  if (
    data.cryptoAlgoEntryPriceBandEnabled != null &&
    typeof data.cryptoAlgoEntryPriceBandEnabled !== 'boolean'
  ) {
    errors.push({
      field: 'cryptoAlgoEntryPriceBandEnabled',
      message: 'must be a boolean',
    });
  }
  if (
    data.cryptoAlgoCurveFilterEnabled != null &&
    typeof data.cryptoAlgoCurveFilterEnabled !== 'boolean'
  ) {
    errors.push({
      field: 'cryptoAlgoCurveFilterEnabled',
      message: 'must be a boolean',
    });
  }
  checkPositiveInt(
    'cryptoAlgoCurveLookbackMs',
    data.cryptoAlgoCurveLookbackMs,
    MIN_CRYPTO_ALGO_CURVE_LOOKBACK_MS,
    MAX_CRYPTO_ALGO_CURVE_LOOKBACK_MS,
  );
  checkPositiveReal(
    'cryptoAlgoCurveMinDelta',
    data.cryptoAlgoCurveMinDelta,
    0.001,
    0.2,
  );
  checkPositiveReal(
    'cryptoAlgoSpreadAdjustmentFactor',
    data.cryptoAlgoSpreadAdjustmentFactor,
    0,
    5,
  );
  checkPositiveReal(
    'cryptoAlgoMinSpreadAbsForAdjustment',
    data.cryptoAlgoMinSpreadAbsForAdjustment,
    0,
    0.5,
  );
  checkPositiveReal('cryptoAlgoMaxSpreadAbs', data.cryptoAlgoMaxSpreadAbs, 0.001, 0.5);
  checkPositiveReal(
    'cryptoAlgoPriceSumTolerance',
    data.cryptoAlgoPriceSumTolerance,
    0.001,
    0.2,
  );
  checkPositiveReal(
    'cryptoAlgoWarnPriceDeviation',
    data.cryptoAlgoWarnPriceDeviation,
    0.01,
    0.5,
  );
  checkPositiveInt('cryptoAlgoMaxBookAgeMs', data.cryptoAlgoMaxBookAgeMs, 1000, 300_000);
  checkPositiveInt(
    'cryptoAlgoGammaCacheTtlShortMs',
    data.cryptoAlgoGammaCacheTtlShortMs,
    1000,
    300_000,
  );
  checkPositiveInt(
    'cryptoAlgoGammaCacheTtlDefaultMs',
    data.cryptoAlgoGammaCacheTtlDefaultMs,
    1000,
    600_000,
  );
  checkPositiveReal(
    'cryptoAlgoGammaStaleOnErrorFactor',
    data.cryptoAlgoGammaStaleOnErrorFactor,
    1,
    10,
  );
  checkPositiveInt('cryptoAlgoWsDebounceMs', data.cryptoAlgoWsDebounceMs, 0, 60_000);
  checkPositiveInt('cryptoAlgoPollMs', data.cryptoAlgoPollMs, 1000, 600_000);
  checkPositiveInt('cryptoAlgoTickIntervalMs', data.cryptoAlgoTickIntervalMs, 100, 60_000);
  checkPositiveInt(
    'cryptoAlgoTickRetentionHours',
    data.cryptoAlgoTickRetentionHours,
    1,
    720,
  );
  checkPositiveReal('cryptoAlgoPriceTickRefQty', data.cryptoAlgoPriceTickRefQty, 1, 10_000);
  checkPositiveInt(
    'cryptoAlgoMinTimeToCloseBufferSeconds',
    data.cryptoAlgoMinTimeToCloseBufferSeconds,
    0,
    600,
  );
  checkPositiveInt(
    'cryptoAlgoLastCloseableBidMaxAgeMs',
    data.cryptoAlgoLastCloseableBidMaxAgeMs,
    1000,
    600_000,
  );

  // SL quota validation
  if (data.cryptoAlgoSlQuotaEnabled != null && typeof data.cryptoAlgoSlQuotaEnabled !== 'boolean') {
    errors.push({ field: 'cryptoAlgoSlQuotaEnabled', message: 'must be a boolean' });
  }
  checkPositiveInt('cryptoAlgoSlQuotaPerMarket', data.cryptoAlgoSlQuotaPerMarket, 1, 20);
  checkPositiveInt('cryptoAlgoSlQuotaCacheTtlSeconds', data.cryptoAlgoSlQuotaCacheTtlSeconds, 5, 600);

  const validateNumberMap = (
    field: string,
    value: unknown,
    min: number,
    max: number,
    integerOnly = false,
  ) => {
    if (value == null) return;
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ field, message: 'must be an object or null' });
      return;
    }
    for (const [key, num] of Object.entries(value as Record<string, unknown>)) {
      if (!isValidIntervalKey(key)) {
        errors.push({
          field: `${field}.${key}`,
          message: `invalid interval key (allowed: ${CRYPTO_ALGO_VALID_INTERVALS.join(', ')})`,
        });
        continue;
      }
      if (typeof num !== 'number' || !Number.isFinite(num) || num < min || num > max) {
        errors.push({
          field: `${field}.${key}`,
          message: `must be a number between ${min} and ${max}`,
        });
        continue;
      }
      if (integerOnly && !Number.isInteger(num)) {
        errors.push({
          field: `${field}.${key}`,
          message: 'must be an integer (seconds)',
        });
      }
    }
  };

  validateNumberMap(
    'cryptoAlgoSpreadAbsByInterval',
    data.cryptoAlgoSpreadAbsByInterval,
    0.001,
    0.5,
  );
  validateNumberMap(
    'cryptoAlgoPreCloseSecondsByInterval',
    data.cryptoAlgoPreCloseSecondsByInterval,
    0,
    3600,
    true,
  );

  const exitMap = data.cryptoAlgoExitDefaultsByInterval;
  if (exitMap != null) {
    if (typeof exitMap !== 'object' || Array.isArray(exitMap)) {
      errors.push({
        field: 'cryptoAlgoExitDefaultsByInterval',
        message: 'must be an object or null',
      });
    } else {
      for (const [key, entry] of Object.entries(
        exitMap as Record<string, unknown>,
      )) {
        if (!isValidIntervalKey(key)) {
          errors.push({
            field: `cryptoAlgoExitDefaultsByInterval.${key}`,
            message: `invalid interval key (allowed: ${CRYPTO_ALGO_VALID_INTERVALS.join(', ')})`,
          });
          continue;
        }
        if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push({
            field: `cryptoAlgoExitDefaultsByInterval.${key}`,
            message: 'must be an object',
          });
          continue;
        }
        const obj = entry as Record<string, unknown>;
        checkPositiveReal(
          `cryptoAlgoExitDefaultsByInterval.${key}.slPercent`,
          obj.slPercent,
          0,
          100,
        );
        checkPositiveReal(
          `cryptoAlgoExitDefaultsByInterval.${key}.tpPercent`,
          obj.tpPercent,
          0,
          100,
        );
        checkPositiveReal(
          `cryptoAlgoExitDefaultsByInterval.${key}.trailingPercent`,
          obj.trailingPercent,
          0,
          100,
        );
        checkPositiveReal(
          `cryptoAlgoExitDefaultsByInterval.${key}.trailingActivationPercent`,
          obj.trailingActivationPercent,
          0,
          100,
        );
      }
    }
  }

  return errors;
}
