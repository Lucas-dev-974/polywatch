import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import {
  getStrategyParams,
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  type WeatherStrategyParamsBag,
} from '../weather/strategy-catalog.js';
import { isMarketTagAllowed } from '../market/tags.js';
import type {
  MoveEventType,
  OrderReason,
  SizingMode,
  TradingMode,
} from '../types/index.js';

/** Tiny tolerance for floating-point percent comparisons. */
const PERCENT_EPSILON = 1e-9;

/**
 * Fail-closed gate for independent exit legs (SL / TP / trailing).
 * Only an explicit `true` enables the leg.
 */
export function isExitLegEnabled(flag: boolean | null | undefined): boolean {
  return flag === true;
}

export interface ModeSizingParams {
  sizingMode: SizingMode;
  copyRatio: number;
  fixedUsdcAmount: number;
  /** Share count for `fixed_shares` sizing. */
  fixedShareCount: number;
  /** Kelly fraction for `kelly_fractional` sizing (0..1). */
  kellyFraction?: number;
  /** Fixed risk budget per trade for `risk_based` sizing (USDC). */
  riskBudgetUsdc?: number;
  /** Default win probability estimate for Kelly sizing. */
  defaultWinProbability?: number;
  /** Scale/gate entry size from spread, expiry, trader stats. */
  signalScoreSizingEnabled: boolean;
}

export interface CopyEntryExitParams {
  slPercent: number | null;
  tpPercent: number | null;
  trailingPercent: number | null;
  trailingActivationPercent: number | null;
}

export function isEntryBidAskRatioAcceptable(
  bidVwap: number,
  askVwap: number,
  minBidToAskRatio: number,
): boolean {
  if (minBidToAskRatio <= 0) return true;
  if (askVwap <= 0 || bidVwap <= 0) return false;
  return bidVwap / askVwap >= minBidToAskRatio;
}

export type MomentumDecision = 'pass' | 'block' | 'skip_no_avg';

export function evaluateMomentumEntry(
  entryAskVwap: number,
  traderAvgPrice: number | null | undefined,
  enabled: boolean,
): MomentumDecision {
  if (!enabled) return 'pass';
  if (traderAvgPrice == null || traderAvgPrice <= 0) return 'skip_no_avg';
  if (entryAskVwap <= 0) return 'skip_no_avg';
  return entryAskVwap >= traderAvgPrice ? 'pass' : 'block';
}

export interface ModePreCloseParams {
  preCloseEnabled: boolean;
  preCloseSeconds: number;
  keepEnabled: boolean;
  keepBidThreshold: number;
}

export function getCopyPreCloseParams(cfg: CopyConfig, mode: TradingMode): ModePreCloseParams {
  return {
    preCloseEnabled: mode === 'sim' ? cfg.simPreCloseEnabled : cfg.realPreCloseEnabled,
    preCloseSeconds: mode === 'sim' ? cfg.simPreCloseSeconds : cfg.realPreCloseSeconds,
    keepEnabled: mode === 'sim' ? cfg.simPreCloseKeepEnabled : cfg.realPreCloseKeepEnabled,
    keepBidThreshold: mode === 'sim' ? cfg.simPreCloseKeepBidThreshold : cfg.realPreCloseKeepBidThreshold,
  };
}

export function getWeatherPreCloseParams(
  _cfg: WeatherConfig,
  _mode: TradingMode,
  _strategyId?: string | null,
): ModePreCloseParams {
  // Weather pre-close feature removed — positions hold until resolution.
  return {
    preCloseEnabled: false,
    preCloseSeconds: 0,
    keepEnabled: false,
    keepBidThreshold: 0.80,
  };
}

export interface WeatherPreCloseAggregate {
  enabled: boolean;
  seconds: number;
}

/**
 * Aggregate weather pre-close across enabled strategies. The weather pre-close
 * feature is removed, so this always reports disabled (0 seconds) — kept for
 * interface compatibility so consumers (market refresh / resolution polling)
 * fall back to copy/crypto pre-close windows only.
 */
export function resolveWeatherPreCloseAggregate(
  _cfg: WeatherConfig,
): WeatherPreCloseAggregate {
  return { enabled: false, seconds: 0 };
}

export interface PreCloseCheckSource {
  simPreCloseEnabled?: boolean;
  realPreCloseEnabled?: boolean;
  simPreCloseSeconds?: number;
  realPreCloseSeconds?: number;
  cryptoAlgoPreCloseEnabled?: boolean | null;
  cryptoAlgoPreCloseSeconds?: number | null;
}

export function isAnyPreCloseEnabled(cfg: PreCloseCheckSource): boolean {
  if (cfg.simPreCloseEnabled || cfg.realPreCloseEnabled) return true;
  if (cfg.cryptoAlgoPreCloseEnabled === true) return true;
  return false;
}

export function getMaxPreCloseSeconds(cfg: PreCloseCheckSource): number {
  const modeMax = Math.max(
    cfg.simPreCloseEnabled ? cfg.simPreCloseSeconds ?? 0 : 0,
    cfg.realPreCloseEnabled ? cfg.realPreCloseSeconds ?? 0 : 0,
  );
  const cryptoIntervalMax = 600;
  // Crypto window length is independent of enabled (null ≡ false for sells).
  // Still include it for near-end market refresh / entry gating heuristics.
  const algoSeconds = cfg.cryptoAlgoPreCloseSeconds ?? cryptoIntervalMax;
  return Math.max(modeMax, algoSeconds);
}

export interface CopyIncreaseSlProximityResult {
  allowed: boolean;
  reason: string | null;
  closurePnlPercent?: number;
  thresholdPercent?: number;
}

export function evaluateCopyIncreaseSlProximity(input: {
  enabled: boolean;
  slPercent: number | null | undefined;
  proximityPercent: number;
  closurePnlPercent: number;
}): CopyIncreaseSlProximityResult {
  const { enabled, slPercent, proximityPercent, closurePnlPercent } = input;
  if (!enabled) return { allowed: true, reason: null };
  if (slPercent == null || slPercent <= 0) return { allowed: true, reason: null };
  if (proximityPercent <= 0) return { allowed: true, reason: null };
  const threshold = -slPercent * Math.min(100, proximityPercent) / 100;
  if (closurePnlPercent <= threshold) {
    return {
      allowed: false,
      reason: `Augmentation refusée — position déjà à ${closurePnlPercent.toFixed(1)}% (seuil proximité SL ${proximityPercent}%)`,
      closurePnlPercent,
      thresholdPercent: threshold,
    };
  }
  return { allowed: true, reason: null, closurePnlPercent, thresholdPercent: threshold };
}

export function evaluateSlTpTrailing(input: {
  effectiveTrigger: number;
  effectiveClosure: number;
  /** Stop-loss threshold as % of invested amount. */
  slPercent?: number | null;
  /** Take-profit threshold as % of invested amount. */
  tpPercent?: number | null;
  /** Trailing drawdown threshold as % of invested amount. */
  trailingPercent?: number | null;
  /** Trailing activation threshold as % of invested amount. */
  trailingActivationPercent?: number | null;
  /** Peak closure PnL % reached during the position lifetime. */
  peakClosurePnlPercent?: number | null;
}): Extract<OrderReason, 'SL' | 'TP' | 'TRAILING'> | null {
  const {
    effectiveTrigger,
    effectiveClosure,
    slPercent,
    tpPercent,
    trailingPercent,
    trailingActivationPercent,
    peakClosurePnlPercent,
  } = input;

  if (slPercent != null && slPercent > 0) {
    if (effectiveClosure <= -slPercent + PERCENT_EPSILON) {
      return 'SL';
    }
  }

  if (tpPercent != null && tpPercent > 0) {
    if (effectiveClosure >= tpPercent - PERCENT_EPSILON && effectiveTrigger >= 0) {
      return 'TP';
    }
  }

  if (trailingPercent != null && trailingPercent > 0) {
    const armed =
      trailingActivationPercent == null ||
      effectiveClosure >= trailingActivationPercent - PERCENT_EPSILON;
    const peak = peakClosurePnlPercent ?? effectiveClosure;
    if (armed && peak - effectiveClosure >= trailingPercent - PERCENT_EPSILON) {
      return 'TRAILING';
    }
  }

  return null;
}

export type PreCloseScopeInput = {
  preCloseEnabled: boolean;
  preCloseSeconds: number;
  timeToEndMs: number;
  acceptingOrders?: boolean | null;
};

export function isPreCloseMonitoringScope(input: PreCloseScopeInput): boolean {
  if (!input.preCloseEnabled) return false;
  return input.timeToEndMs <= input.preCloseSeconds * 1000;
}

export function isPreCloseExitScope(
  input: PreCloseScopeInput & { acceptingOrders: boolean | null },
): boolean {
  if (!isPreCloseMonitoringScope(input)) return false;
  if (input.timeToEndMs > 0) return true;
  return input.acceptingOrders === true;
}

// ═══════════════════════════════════════════════════════════════════════
// NEW: Per-algo friction getters (for use with isolated configs)
// ═══════════════════════════════════════════════════════════════════════

// ─── Copy getters ─────────────────────────────────────────────────────

export function getCopyMaxOpenPositions(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simMaxOpenPositions : cfg.realMaxOpenPositions;
}

export function getCopyMaxPositionSizeUsdc(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simMaxPositionSizeUsdc : cfg.realMaxPositionSizeUsdc;
}

export function getCopyMaxExposureUsdc(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simMaxExposureUsdc : cfg.realMaxExposureUsdc;
}

export function getCopyMaxDailyLossUsdc(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simMaxDailyLossUsdc : cfg.realMaxDailyLossUsdc;
}

export function getCopyEntryDepthRetryMax(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simEntryDepthRetryMax : cfg.realEntryDepthRetryMax;
}

export function getCopyEntryDepthRetryDelayMs(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simEntryDepthRetryDelayMs : cfg.realEntryDepthRetryDelayMs;
}

export function getCopySlCloseMaxRetries(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simSlCloseMaxRetries : cfg.realSlCloseMaxRetries;
}

export function getCopyKillSwitchAction(
  cfg: CopyConfig,
  mode: TradingMode,
): string {
  return mode === 'sim' ? cfg.simKillSwitchAction : cfg.realKillSwitchAction;
}

export function getCopyMinBidToAskRatio(
  cfg: CopyConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.simMinBidToAskRatio : cfg.realMinBidToAskRatio;
}

export function getCopySlConfirmationTicks(cfg: CopyConfig): number {
  return cfg.slConfirmationTicks;
}

// ── Copy-specific sizing ─────────────────────────────────────────
export function getCopySizingParams(
  cfg: CopyConfig,
  mode: TradingMode,
): ModeSizingParams {
  if (mode === 'sim') {
    return {
      sizingMode: cfg.simSizingMode as SizingMode,
      copyRatio: cfg.simCopyRatio,
      fixedUsdcAmount: cfg.simEntryUsdcAmount,
      fixedShareCount: cfg.simEntryShareCount,
      kellyFraction: cfg.simKellyFraction,
      riskBudgetUsdc: cfg.simRiskBudgetUsdc,
      defaultWinProbability: cfg.simDefaultWinProbability,
      signalScoreSizingEnabled: cfg.simSignalScoreSizingEnabled,
    };
  }
  return {
    sizingMode: cfg.realSizingMode as SizingMode,
    copyRatio: cfg.realCopyRatio,
    fixedUsdcAmount: cfg.realEntryUsdcAmount,
    fixedShareCount: cfg.realEntryShareCount,
    kellyFraction: cfg.realKellyFraction,
    riskBudgetUsdc: cfg.realRiskBudgetUsdc,
    defaultWinProbability: cfg.realDefaultWinProbability,
    signalScoreSizingEnabled: cfg.realSignalScoreSizingEnabled,
  };
}

// ── Copy-specific exit params ────────────────────────────────────
export function resolveCopyEntryExitParams(
  cfg: CopyConfig,
  mode: TradingMode,
): CopyEntryExitParams {
  const slEnabled = isExitLegEnabled(
    mode === 'sim' ? cfg.simSlEnabled : cfg.realSlEnabled,
  );
  const tpEnabled = isExitLegEnabled(
    mode === 'sim' ? cfg.simTpEnabled : cfg.realTpEnabled,
  );
  const trailingEnabled = isExitLegEnabled(
    mode === 'sim' ? cfg.simTrailingEnabled : cfg.realTrailingEnabled,
  );
  return {
    slPercent: slEnabled
      ? (mode === 'sim' ? cfg.simSlPercent : cfg.realSlPercent)
      : null,
    tpPercent: tpEnabled
      ? (mode === 'sim' ? cfg.simTpPercent : cfg.realTpPercent)
      : null,
    trailingPercent: trailingEnabled
      ? (mode === 'sim' ? cfg.simTrailingPercent : cfg.realTrailingPercent)
      : null,
    trailingActivationPercent: trailingEnabled
      ? (mode === 'sim' ? cfg.simTrailingActivationPercent : cfg.realTrailingActivationPercent)
      : null,
  };
}

// ── Copy-specific helpers ────────────────────────────────────────
export function getCopyMomentumFilterEnabled(cfg: CopyConfig, mode: TradingMode): boolean {
  return mode === 'sim' ? cfg.simMomentumFilterEnabled : cfg.realMomentumFilterEnabled;
}

export function getCopyMinTimeToClose(cfg: CopyConfig, mode: TradingMode): number {
  return mode === 'sim' ? cfg.simMinTimeToClose : cfg.realMinTimeToClose;
}

export function getCopyAllowedMarketTags(cfg: CopyConfig, mode: TradingMode): string[] {
  const json = mode === 'sim' ? cfg.simAllowedMarketTags : cfg.realAllowedMarketTags;
  try { return JSON.parse(json); } catch { return []; }
}

export function getCopyCopyIncreaseSlProximityEnabled(cfg: CopyConfig, mode: TradingMode): boolean {
  return mode === 'sim' ? cfg.simCopyIncreaseSlProximityEnabled : cfg.realCopyIncreaseSlProximityEnabled;
}

export function getCopyCopyIncreaseSlProximityPercent(cfg: CopyConfig, mode: TradingMode): number {
  return mode === 'sim' ? cfg.simCopyIncreaseSlProximityPercent : cfg.realCopyIncreaseSlProximityPercent;
}

export function isCopyMoveAllowed(
  moveType: MoveEventType,
  cfg: CopyConfig,
  mode: TradingMode,
): boolean {
  if (moveType === 'INCREASED') {
    return mode === 'sim' ? cfg.simCopyIncreaseEnabled : cfg.realCopyIncreaseEnabled;
  }
  if (moveType === 'DECREASED') {
    return mode === 'sim' ? cfg.simCopyDecreaseEnabled : cfg.realCopyDecreaseEnabled;
  }
  return true;
}

export function isIncreaseAllowed(
  increaseCount: number,
  cfg: CopyConfig,
  mode: TradingMode,
): boolean {
  const max = mode === 'sim' ? cfg.simMaxIncreasesPerPosition : cfg.realMaxIncreasesPerPosition;
  if (max <= 0) return true;
  return increaseCount < max;
}

// ─── Crypto getters ───────────────────────────────────────────────────

export function getCryptoMaxOpenPositions(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoMaxOpenPositions : cfg.cryptoAlgoMaxOpenPositions;
}

export function getCryptoMaxPositionSizeUsdc(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoMaxPositionSizeUsdc : cfg.cryptoAlgoMaxPositionSizeUsdc;
}

export function getCryptoMaxExposureUsdc(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoMaxExposureUsdc : cfg.cryptoAlgoMaxExposureUsdc;
}

export function getCryptoMaxDailyLossUsdc(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoMaxDailyLossUsdc : cfg.cryptoAlgoMaxDailyLossUsdc;
}

export function getCryptoEntryDepthRetryMax(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoEntryDepthRetryMax : cfg.cryptoAlgoEntryDepthRetryMax;
}

export function getCryptoEntryDepthRetryDelayMs(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoEntryDepthRetryDelayMs : cfg.cryptoAlgoEntryDepthRetryDelayMs;
}

export function getCryptoSlCloseMaxRetries(
  cfg: CryptoConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? cfg.cryptoAlgoSlCloseMaxRetries : cfg.cryptoAlgoSlCloseMaxRetries;
}

export function getCryptoKillSwitchAction(
  cfg: CryptoConfig,
  mode: TradingMode,
): string {
  return mode === 'sim' ? cfg.cryptoAlgoKillSwitchAction : cfg.cryptoAlgoKillSwitchAction;
}

/** @deprecated Dead field — never called by crypto-algo entry/sizing paths. */
export function getCryptoMinBidToAskRatio(
  cfg: CryptoConfig,
  _mode: TradingMode,
): number {
  return cfg.cryptoAlgoMinBidToAskRatio;
}

export function getCryptoSlConfirmationTicks(cfg: CryptoConfig): number {
  return cfg.cryptoAlgoSlConfirmationTicks;
}

// ─── Weather getters ──────────────────────────────────────────────────
//
// Per-strategy config: when a strategyId is provided the getter resolves the
// full params bag via getStrategyParams (catalogue defaults + stored overrides).
// When strategyId is null/undefined (legacy positions, backtest, copy/crypto
// callers) the getter falls back to the catalogue defaults — never to the
// legacy global WeatherConfig columns.

function weatherBag(cfg: WeatherConfig, strategyId?: string | null): WeatherStrategyParamsBag {
  if (strategyId) return getStrategyParams(cfg, strategyId);
  return DEFAULT_WEATHER_STRATEGY_PARAMS;
}

export function getWeatherMaxOpenPositions(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).maxOpenPositions;
}

export function getWeatherMaxPositionSizeUsdc(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).maxPositionSizeUsdc;
}

export function getWeatherMaxExposureUsdc(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).maxExposureUsdc;
}

export function getWeatherMaxDailyLossUsdc(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).maxDailyLossUsdc;
}

export function getWeatherEntryDepthRetryMax(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).entryDepthRetryMax;
}

export function getWeatherEntryDepthRetryDelayMs(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).entryDepthRetryDelayMs;
}

export function getWeatherSlCloseMaxRetries(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).slCloseMaxRetries;
}

export function getWeatherKillSwitchAction(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): string {
  return weatherBag(cfg, strategyId).killSwitchAction;
}

export function getWeatherMinBidToAskRatio(
  cfg: WeatherConfig,
  _mode: TradingMode,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).minBidToAskRatio;
}

export function getWeatherSlConfirmationTicks(
  cfg: WeatherConfig,
  strategyId?: string | null,
): number {
  return weatherBag(cfg, strategyId).slConfirmationTicks;
}
