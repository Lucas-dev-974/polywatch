import type { RiskConfig } from '../entities/RiskConfig.js';
import {
  isMarketTagAllowed,
  parseAllowedMarketTags,
} from '../market/tags.js';
import type {
  MoveEventType,
  OrderReason,
  SizingMode,
  TradingMode,
} from '../types/index.js';

/** Cap for take-profit in bid points on binary markets (max bid is 1.00). */
export const BINARY_TP_BID_CAP = 0.99;

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

export interface ModeExitParams {
  trailingBidPoints?: number;
  trailingActivationBidPoints?: number;
}

export function getModeSizingParams(
  risk: RiskConfig,
  mode: TradingMode,
): ModeSizingParams {
  if (mode === 'sim') {
    return {
      sizingMode: risk.simSizingMode as SizingMode,
      copyRatio: risk.simCopyRatio,
      fixedUsdcAmount: risk.simEntryUsdcAmount,
      fixedShareCount: risk.simEntryShareCount,
      kellyFraction: risk.simKellyFraction,
      riskBudgetUsdc: risk.simRiskBudgetUsdc,
      defaultWinProbability: risk.simDefaultWinProbability,
      signalScoreSizingEnabled: risk.simSignalScoreSizingEnabled,
    };
  }
  return {
    sizingMode: risk.realSizingMode as SizingMode,
    copyRatio: risk.realCopyRatio,
    fixedUsdcAmount: risk.realEntryUsdcAmount,
    fixedShareCount: risk.realEntryShareCount,
    kellyFraction: risk.realKellyFraction,
    riskBudgetUsdc: risk.realRiskBudgetUsdc,
    defaultWinProbability: risk.realDefaultWinProbability,
    signalScoreSizingEnabled: risk.realSignalScoreSizingEnabled,
  };
}

export function getModeExitParams(
  risk: RiskConfig,
  mode: TradingMode,
): ModeExitParams {
  if (mode === 'sim') {
    return {
      trailingBidPoints: risk.simTrailingEnabled
        ? risk.simTrailingBidPoints
        : undefined,
      trailingActivationBidPoints: risk.simTrailingEnabled
        ? risk.simTrailingActivationBidPoints
        : undefined,
    };
  }
  return {
    trailingBidPoints: risk.realTrailingEnabled
      ? risk.realTrailingBidPoints
      : undefined,
    trailingActivationBidPoints: risk.realTrailingEnabled
      ? risk.realTrailingActivationBidPoints
      : undefined,
  };
}

export interface CopyEntryExitParams {
  slBidPoints: number | null;
  tpBidPoints: number | null;
  trailingBidPoints: number | null;
  trailingActivationBidPoints: number | null;
}

/**
 * Resolve exit params for copy trading entries — bid points only.
 *
 * Copy trading on binary markets uses absolute bid points (not percentages)
 * because percent-based SL/TP is ill-suited to the [0,1] price range.
 *
 * SL, TP and trailing are gated independently via `*SlEnabled`, `*TpEnabled`
 * and `*TrailingEnabled`.
 */
export function resolveCopyEntryExitParams(
  risk: RiskConfig,
  mode: TradingMode,
): CopyEntryExitParams {
  const slEnabled = isExitLegEnabled(
    pickModeValue<boolean>(risk, mode, 'SlEnabled'),
  );
  const tpEnabled = isExitLegEnabled(
    pickModeValue<boolean>(risk, mode, 'TpEnabled'),
  );
  const trailingEnabled = isExitLegEnabled(
    pickModeValue<boolean>(risk, mode, 'TrailingEnabled'),
  );
  return {
    slBidPoints: slEnabled
      ? pickModeValue<number>(risk, mode, 'SlBidPoints')
      : null,
    tpBidPoints: tpEnabled
      ? pickModeValue<number>(risk, mode, 'TpBidPoints')
      : null,
    trailingBidPoints: trailingEnabled
      ? pickModeValue<number>(risk, mode, 'TrailingBidPoints')
      : null,
    trailingActivationBidPoints: trailingEnabled
      ? pickModeValue<number>(risk, mode, 'TrailingActivationBidPoints')
      : null,
  };
}

function pickModeValue<T>(
  risk: RiskConfig,
  mode: TradingMode,
  suffix: string,
): T {
  return risk[`${mode}${suffix}` as keyof RiskConfig] as T;
}

export function getModeMaxOpenPositions(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? risk.simMaxOpenPositions : risk.realMaxOpenPositions;
}

export function getModeMaxPositionSizeUsdc(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'MaxPositionSizeUsdc');
}

export function getModeMaxExposureUsdc(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'MaxExposureUsdc');
}

export function getModeMaxDailyLossUsdc(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'MaxDailyLossUsdc');
}

export function getModeMinBidToAskRatio(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'MinBidToAskRatio');
}

export function getModeEntryDepthRetryMax(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'EntryDepthRetryMax');
}

export function getModeEntryDepthRetryDelayMs(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'EntryDepthRetryDelayMs');
}

/**
 * Gate copy entries when the executable bid VWAP is too far below the ask
 * VWAP for the target quantity. A ratio of `0` disables the check.
 */
export function isEntryBidAskRatioAcceptable(
  bidVwap: number,
  askVwap: number,
  minBidToAskRatio: number,
): boolean {
  if (minBidToAskRatio <= 0) return true;
  if (askVwap <= 0 || bidVwap <= 0) return false;
  return bidVwap / askVwap >= minBidToAskRatio;
}

export function getModeMomentumFilterEnabled(
  risk: RiskConfig,
  mode: TradingMode,
): boolean {
  return pickModeValue<boolean>(risk, mode, 'MomentumFilterEnabled');
}

export type MomentumDecision = 'pass' | 'block' | 'skip_no_avg';

/**
 * Momentum entry gate. Returns:
 * - `'pass'`        : entry allowed (price >= trader avg, or filter disabled)
 * - `'block'`       : entry rejected (price strictly below trader avg)
 * - `'skip_no_avg'` : trader avg price (or quote) unavailable → fail-open (do not block)
 *
 * The three-state return (instead of a boolean) keeps the `skip_no_avg` case
 * observable: when the trader avg price is not yet consolidated, the filter is
 * silently short-circuited rather than blocking, and that must be measurable.
 */
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

export function getModeKillSwitchAction(
  risk: RiskConfig,
  mode: TradingMode,
): string {
  return mode === 'sim' ? risk.simKillSwitchAction : risk.realKillSwitchAction;
}

export function getModeMinTimeToClose(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? risk.simMinTimeToClose : risk.realMinTimeToClose;
}

export interface ModePreCloseParams {
  preCloseEnabled: boolean;
  preCloseSeconds: number;
  keepEnabled: boolean;
  keepBidThreshold: number;
}

export function getModePreCloseParams(
  risk: RiskConfig,
  mode: TradingMode,
): ModePreCloseParams {
  return {
    preCloseEnabled: pickModeValue<boolean>(risk, mode, 'PreCloseEnabled'),
    preCloseSeconds: pickModeValue<number>(risk, mode, 'PreCloseSeconds'),
    keepEnabled: pickModeValue<boolean>(risk, mode, 'PreCloseKeepEnabled'),
    keepBidThreshold: pickModeValue<number>(risk, mode, 'PreCloseKeepBidThreshold'),
  };
}

export function getModeSlCloseMaxRetries(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return mode === 'sim' ? risk.simSlCloseMaxRetries : risk.realSlCloseMaxRetries;
}

export function isAnyPreCloseEnabled(risk: RiskConfig): boolean {
  if (risk.simPreCloseEnabled || risk.realPreCloseEnabled) return true;
  if (risk.cryptoAlgoPreCloseEnabled === true) return true;
  return false;
}

export function getMaxPreCloseSeconds(risk: RiskConfig): number {
  const modeMax = Math.max(
    risk.simPreCloseEnabled ? risk.simPreCloseSeconds : 0,
    risk.realPreCloseEnabled ? risk.realPreCloseSeconds : 0,
  );
  /** Crypto interval table max (1d/4h) — keep in sync with crypto-algo-exit.ts */
  const cryptoIntervalMax = 600;
  if (risk.cryptoAlgoPreCloseEnabled === false) {
    return Math.max(modeMax, 0);
  }
  const algoSeconds =
    risk.cryptoAlgoPreCloseSeconds ??
    (risk.cryptoAlgoPreCloseEnabled === true ||
    risk.cryptoAlgoPreCloseEnabled == null
      ? cryptoIntervalMax
      : 0);
  return Math.max(modeMax, algoSeconds);
}

export function isCopyMoveAllowed(
  moveType: MoveEventType,
  risk: RiskConfig,
  mode: TradingMode,
): boolean {
  if (moveType === 'INCREASED') {
    return pickModeValue<boolean>(risk, mode, 'CopyIncreaseEnabled');
  }
  if (moveType === 'DECREASED') {
    return pickModeValue<boolean>(risk, mode, 'CopyDecreaseEnabled');
  }
  return true;
}

export function isIncreaseAllowed(
  increaseCount: number,
  risk: RiskConfig,
  mode: TradingMode,
): boolean {
  const max = pickModeValue<number>(risk, mode, 'MaxIncreasesPerPosition');
  if (max <= 0) return true;
  return increaseCount < max;
}

export function getModeCopyIncreaseSlProximityEnabled(
  risk: RiskConfig,
  mode: TradingMode,
): boolean {
  return pickModeValue<boolean>(risk, mode, 'CopyIncreaseSlProximityEnabled');
}

export function getModeCopyIncreaseSlProximityPercent(
  risk: RiskConfig,
  mode: TradingMode,
): number {
  return pickModeValue<number>(risk, mode, 'CopyIncreaseSlProximityPercent');
}

export interface CopyIncreaseSlProximityResult {
  allowed: boolean;
  reason: string | null;
  closurePnlPercent?: number;
  thresholdPercent?: number;
}

/**
 * Gate COPY_INCREASE when the existing position is already close to its SL.
 *
 * Uses the configured SL bid points and a proximity ratio (0..100). When enabled,
 * an increase is rejected if the position's closure PnL percent has breached
 * `proximityPercent %` of the SL threshold.
 *
 * Example: SL=-100%, proximity=80% => block increases when closure <= -80%.
 */
export function evaluateCopyIncreaseSlProximity(input: {
  enabled: boolean;
  slBidPoints: number | null | undefined;
  entryBidVwap: number | null | undefined;
  proximityPercent: number;
  closurePnlPercent: number;
}): CopyIncreaseSlProximityResult {
  const { enabled, slBidPoints, entryBidVwap, proximityPercent, closurePnlPercent } = input;
  if (!enabled) return { allowed: true, reason: null };
  if (slBidPoints == null || slBidPoints <= 0 || entryBidVwap == null || entryBidVwap <= 0) return { allowed: true, reason: null };
  if (proximityPercent <= 0) return { allowed: true, reason: null };
  // Convert bid points to percent of entry for proximity check
  const slPercent = (slBidPoints / entryBidVwap) * 100;
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

export function getModeAllowedMarketTags(
  risk: RiskConfig,
  mode: TradingMode,
): string[] {
  const json = pickModeValue<string>(risk, mode, 'AllowedMarketTags');
  return parseAllowedMarketTags(json);
}

export function isMarketTagAllowedForMode(
  marketSlugs: string[],
  risk: RiskConfig,
  mode: TradingMode,
): boolean {
  return isMarketTagAllowed(marketSlugs, getModeAllowedMarketTags(risk, mode));
}

/**
 * Whether the trailing stop is armed, i.e. allowed to trigger a close.
 *
 * The trailing stays disarmed until the current bid has reached the activation
 * threshold above the entry bid VWAP at least once. Because the peak bid is
 * monotonic (max over the position lifetime), once armed the trailing stays armed.
 *
 * A `null` or `undefined` activation means "no activation gate": the trailing
 * is armed from the moment the position opens (legacy behaviour).
 */
export function isTrailingArmed(
  currentBid: number,
  entryBidVwap: number,
  activationBidPoints?: number | null,
): boolean {
  if (activationBidPoints === null || activationBidPoints === undefined) return true;
  return currentBid >= entryBidVwap + activationBidPoints;
}

/**
 * Evaluate stop-loss / take-profit / trailing-stop close signals for a single
 * position tick. Uses absolute bid points for SL/TP/trailing on binary markets.
 *
 * Priority order is fixed: **SL → TP → TRAILING**. The trailing only fires once
 * {@link isTrailingArmed} returns true (peak bid has crossed the activation
 * threshold) *and* the drawdown from the peak bid reaches `trailingBidPoints`.
 *
 * Returns `null` when no exit condition is met.
 */
export function evaluateSlTpTrailing(input: {
  /** Trailing drawdown from peak bid (bid points). `null`/`0` disables trailing. */
  trailingBidPoints: number | null;
  /**
   * Bid points above entry that the peak bid must have reached at least once
   * before the trailing stop arms. `null`/`undefined` means the trailing is
   * active immediately (legacy behaviour).
   */
  trailingActivationBidPoints?: number | null;
  /** Market-move PnL (bid vs entryBidVwap) — base for SL/TP/trigger. */
  effectiveTrigger: number;
  /** Economic PnL including fees (bid vs entryPrice) — base for hybrid SL/closure. */
  effectiveClosure: number;
  /** Peak bid VWAP for trailing activation and drawdown. */
  peakBidVwap: number;
  /** Stop-loss in bid points (absolute) for binary markets. */
  slBidPoints?: number | null;
  /** Take-profit in bid points (absolute) for binary markets. */
  tpBidPoints?: number | null;
  /** Entry bid VWAP for computing absolute thresholds. */
  entryBidVwap?: number;
}): Extract<OrderReason, 'SL' | 'TP' | 'TRAILING'> | null {
  const {
    trailingBidPoints,
    trailingActivationBidPoints,
    effectiveTrigger,
    effectiveClosure,
    peakBidVwap,
    slBidPoints,
    tpBidPoints,
    entryBidVwap,
  } = input;

  // SL in bid points (binary markets)
  if (slBidPoints != null && entryBidVwap != null && entryBidVwap > 0) {
    const slBidAbsolute = entryBidVwap - slBidPoints;
    const impliedBid = entryBidVwap * (1 + effectiveTrigger / 100);
    if (effectiveTrigger <= 0 && impliedBid <= slBidAbsolute) {
      return 'SL';
    }
  }

  // TP in bid points (binary markets)
  if (tpBidPoints != null && entryBidVwap != null && entryBidVwap > 0) {
    const tpBidAbsolute = Math.min(entryBidVwap + tpBidPoints, BINARY_TP_BID_CAP);
    const impliedBid = entryBidVwap * (1 + effectiveTrigger / 100);
    // TP requires both bid threshold met AND non-negative closure PnL (fee guard)
    if (effectiveTrigger >= 0 && impliedBid >= tpBidAbsolute && effectiveClosure >= 0) {
      return 'TP';
    }
  }

  // Trailing: Uses bid-based peak and drawdown
  if (
    trailingBidPoints != null && trailingBidPoints > 0 &&
    entryBidVwap != null && entryBidVwap > 0
  ) {
    const currentBid = entryBidVwap * (1 + effectiveTrigger / 100);
    if (
      isTrailingArmed(currentBid, entryBidVwap, trailingActivationBidPoints) &&
      peakBidVwap - currentBid >= trailingBidPoints
    ) {
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

/** Market is within the pre-close monitoring window (before or after endDate). */
export function isPreCloseMonitoringScope(input: PreCloseScopeInput): boolean {
  if (!input.preCloseEnabled) return false;
  return input.timeToEndMs <= input.preCloseSeconds * 1000;
}

/** Market matches a pre-close CLOB exit trigger. */
export function isPreCloseExitScope(
  input: PreCloseScopeInput & { acceptingOrders: boolean | null },
): boolean {
  if (!isPreCloseMonitoringScope(input)) return false;
  if (input.timeToEndMs > 0) return true;
  return input.acceptingOrders === true;
}
