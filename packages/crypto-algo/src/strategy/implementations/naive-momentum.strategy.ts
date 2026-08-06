import pino from 'pino';
import type { MarketListItemDto } from '@polywatch/core';
import type { CryptoConfig } from '@polywatch/core';
import { resolveNaiveMomentumConfig } from '@polywatch/core';
import type {
  AlgoSignal,
  ConfigurableCryptoAlgoStrategy,
  EvaluationResult,
  StrategyContext,
  TopOfBookData,
} from '../strategy.js';
import {
  isBilateralBook,
  isFreshBook,
  MAX_BOOK_AGE_MS,
} from '../strategy.js';
import {
  normalizeInterval,
  getMaxSpreadAbsForInterval,
  findOutcomes,
  validateOutcomePrices,
} from '../constants.js';
import {
  evaluateCurveDescendingGate,
} from '../../curve-descending-gate.js';

const log = pino({ name: 'crypto-algo:naive-momentum' });

/** Min interval between insufficient-history debug logs per conditionId. */
const CURVE_INSUFFICIENT_LOG_INTERVAL_MS = 30_000;

/**
 * Configuration for the naive momentum strategy.
 */
export interface NaiveMomentumConfig {
  /**
   * Base momentum threshold (0.5 = neutral).
   * Price must be above this for YES signal, below (1 - threshold) for NO signal.
   * @default 0.55
   */
  baseThreshold: number;

  /**
   * Default max absolute spread (probability points) for 1h+ intervals.
   * Shorter intervals use {@link getMaxSpreadAbsForInterval}.
   * @default 0.02
   */
  maxSpreadAbs: number;

  /**
   * Spread adjustment factor applied to absolute spread.
   * adjustedThreshold = base + spreadAbs * factor
   * @default 0.5
   */
  spreadAdjustmentFactor: number;

  /**
   * Minimum absolute spread to apply threshold adjustment.
   * @default 0.01
   */
  minSpreadAbsForAdjustment: number;

  /**
   * Tolerance for outcome price sum validation (Gamma path only).
   * @default 0.02 (2%)
   */
  priceSumTolerance: number;

  /**
   * Deviation between WS and Gamma that triggers a health warn (non-blocking).
   * @default 0.05
   */
  warnPriceDeviation: number;

  /**
   * Max age of a WS book to use as primary price source.
   * @default {@link MAX_BOOK_AGE_MS}
   */
  maxBookAgeMs: number;

  /**
   * Merged spread-abs table from CryptoConfig (optional).
   */
  spreadAbsByInterval?: Partial<
    Record<'5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '1d', number>
  >;

  /**
   * When true, {@link entryPriceMin}/{@link entryPriceMax} replace momentum
   * threshold for entry direction. @default true
   */
  entryPriceBandEnabled: boolean;

  /** Lower entry band bound (exclusive) on bought-token price. @default 0.55 */
  entryPriceMin: number;

  /** Upper entry band bound (exclusive) on bought-token price. @default 0.80 */
  entryPriceMax: number;

  /** When true, block entry if bought-token mid is descending. @default false */
  curveFilterEnabled: boolean;

  /** Lookback window (ms) for curve descending gate. @default 10000 */
  curveLookbackMs: number;

  /** Minimum mid drop (probability points) to treat as descending. @default 0.01 */
  curveMinDelta: number;
}

const DEFAULT_CONFIG: NaiveMomentumConfig = {
  baseThreshold: 0.55,
  maxSpreadAbs: 0.02,
  spreadAdjustmentFactor: 0.5,
  minSpreadAbsForAdjustment: 0.01,
  priceSumTolerance: 0.02,
  warnPriceDeviation: 0.05,
  maxBookAgeMs: MAX_BOOK_AGE_MS,
  entryPriceBandEnabled: true,
  entryPriceMin: 0.55,
  entryPriceMax: 0.8,
  curveFilterEnabled: false,
  curveLookbackMs: 10_000,
  curveMinDelta: 0.01,
};

/** Resolve BUY direction from entry price band on the bought token. */
export function resolveEntryCandidateFromBand(
  yesPrice: number,
  min: number,
  max: number,
): 'YES' | 'NO' | null {
  if (yesPrice > min && yesPrice < max) return 'YES';
  const noPrice = 1 - yesPrice;
  if (noPrice > min && noPrice < max) return 'NO';
  return null;
}

/**
 * Naive momentum strategy with dynamic spread-based thresholds.
 *
 * Price source: WebSocket mid of YES/Up when the book is fresh and bilateral;
 * Gamma outcome prices as fallback.
 *
 * Spread gate and threshold adjustment use the book of the token the signal
 * would buy (Up for YES, Down for NO), in absolute probability points.
 */
export class NaiveMomentumStrategy implements ConfigurableCryptoAlgoStrategy {
  readonly id = 'naive-momentum';
  private config: NaiveMomentumConfig;
  private readonly lastInsufficientLogByCondition = new Map<string, number>();

  constructor(config: Partial<NaiveMomentumConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Hot-reload tunables from CryptoConfig (called by strategy runner). */
  setConfig(config: Partial<NaiveMomentumConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Registry-driven tunables application (Phase 2.3). */
  applyTunables(cryptoConfig: CryptoConfig): void {
    const tunables = resolveNaiveMomentumConfig(cryptoConfig);
    this.setConfig({
      baseThreshold: tunables.baseThreshold,
      maxSpreadAbs: tunables.maxSpreadAbs,
      spreadAdjustmentFactor: tunables.spreadAdjustmentFactor,
      minSpreadAbsForAdjustment: tunables.minSpreadAbsForAdjustment,
      priceSumTolerance: tunables.priceSumTolerance,
      warnPriceDeviation: tunables.warnPriceDeviation,
      maxBookAgeMs: tunables.maxBookAgeMs,
      spreadAbsByInterval: tunables.spreadAbsByInterval,
      entryPriceBandEnabled: tunables.entryPriceBandEnabled,
      entryPriceMin: tunables.entryPriceMin,
      entryPriceMax: tunables.entryPriceMax,
      curveFilterEnabled: tunables.curveFilterEnabled,
      curveLookbackMs: tunables.curveLookbackMs,
      curveMinDelta: tunables.curveMinDelta,
    });
  }

  async evaluate(
    market: MarketListItemDto,
    ctx: StrategyContext,
  ): Promise<EvaluationResult> {
    const prices = market.outcomePrices;
    if (!prices || prices.length < 2) {
      return { kind: 'abstain', reason: 'no_outcome_prices' };
    }

    const { yesOutcome, noOutcome } = findOutcomes(prices);

    if (!yesOutcome || !noOutcome) {
      log.warn(
        { conditionId: market.conditionId, outcomes: prices.map((p) => p.outcome) },
        'Cannot identify YES/NO outcomes',
      );
      return { kind: 'abstain', reason: 'unknown_outcomes' };
    }

    if (market.interval) {
      const normalized = normalizeInterval(market.interval);
      if (!normalized) {
        log.warn(
          { conditionId: market.conditionId, interval: market.interval },
          'Invalid interval format',
        );
        return {
          kind: 'abstain',
          reason: 'invalid_interval',
          detail: market.interval,
        };
      }
    }

    const nowMs = ctx.now.getTime();
    const upBook = ctx.books?.up ?? null;
    const downBook = ctx.books?.down ?? null;

    const selected = this.selectPrice(
      yesOutcome.price,
      upBook,
      nowMs,
      market.conditionId,
    );

    if (selected.price == null) {
      return {
        kind: 'abstain',
        reason: selected.abstainReason ?? 'no_price_source',
      };
    }

    const { price, priceSource } = selected;

    if (priceSource === 'gamma') {
      const { valid, sum } = validateOutcomePrices(
        yesOutcome.price,
        noOutcome.price,
        this.config.priceSumTolerance,
      );
      if (!valid) {
        log.warn(
          {
            conditionId: market.conditionId,
            yesPrice: yesOutcome.price,
            noPrice: noOutcome.price,
            sum,
          },
          'Invalid outcome prices: sum should be ~1.0',
        );
        return {
          kind: 'abstain',
          reason: 'invalid_price_sum',
          detail: `sum=${sum.toFixed(4)}`,
        };
      }
    }

    // Candidate direction: entry band (default) or legacy momentum threshold.
    let candidate: 'YES' | 'NO' | null = null;
    let threshold: number | null = null;

    if (this.config.entryPriceBandEnabled) {
      candidate = resolveEntryCandidateFromBand(
        price,
        this.config.entryPriceMin,
        this.config.entryPriceMax,
      );
      if (!candidate) {
        return {
          kind: 'abstain',
          reason: 'price_band',
          detail: `yesPrice=${price.toFixed(4)} band=(${this.config.entryPriceMin}, ${this.config.entryPriceMax})`,
        };
      }
    } else {
      const base = this.config.baseThreshold;
      if (price > base) candidate = 'YES';
      else if (price < 1 - base) candidate = 'NO';
      else {
        return { kind: 'abstain', reason: 'neutral_zone' };
      }
    }

    const targetBook = candidate === 'YES' ? upBook : downBook;
    const targetGate = this.resolveTargetSpreadGate(targetBook, nowMs);
    if (targetGate.kind === 'abstain') {
      return targetGate;
    }
    const spreadAbs = targetGate.spreadAbs;

    if (this.config.curveFilterEnabled) {
      const curveSeries =
        candidate === 'YES'
          ? (ctx.midHistory?.up ?? [])
          : (ctx.midHistory?.down ?? []);
      const curveResult = evaluateCurveDescendingGate(curveSeries, {
        minDelta: this.config.curveMinDelta,
        lookbackMs: this.config.curveLookbackMs,
      });
      if (curveResult === 'descending') {
        const first = curveSeries[0]!;
        const last = curveSeries[curveSeries.length - 1]!;
        const delta = last.mid - first.mid;
        const spanMs = last.t - first.t;
        return {
          kind: 'abstain',
          reason: 'curve_descending',
          detail: `delta=${delta.toFixed(4)} spanMs=${spanMs} points=${curveSeries.length} lookbackMs=${this.config.curveLookbackMs}`,
        };
      }
      if (curveResult === 'insufficient') {
        this.logInsufficientCurveHistory(
          market.conditionId,
          candidate,
          curveSeries.length,
          nowMs,
        );
        return {
          kind: 'abstain',
          reason: 'curve_insufficient',
          detail: `points=${curveSeries.length} lookbackMs=${this.config.curveLookbackMs}`,
        };
      }
    }

    const maxSpread = getMaxSpreadAbsForInterval(
      market.interval ?? undefined,
      this.config.maxSpreadAbs,
      this.config.spreadAbsByInterval,
    );

    if (spreadAbs > maxSpread) {
      return {
        kind: 'abstain',
        reason: 'spread_gate',
        detail: `spreadAbs=${spreadAbs.toFixed(4)} max=${maxSpread}`,
      };
    }

    if (!this.config.entryPriceBandEnabled) {
      threshold = this.calculateThreshold(spreadAbs);
      if (candidate === 'YES' && price <= threshold) {
        return { kind: 'abstain', reason: 'neutral_zone' };
      }
      if (candidate === 'NO' && price >= 1 - threshold) {
        return { kind: 'abstain', reason: 'neutral_zone' };
      }
    }

    const signal = this.createSignal(
      market,
      candidate,
      price,
      threshold,
      spreadAbs,
      priceSource,
      this.config.entryPriceBandEnabled,
    );
    if (!signal) {
      return { kind: 'abstain', reason: 'missing_token' };
    }
    return { kind: 'signal', signal };
  }

  /**
   * Fail-closed liquidity gate on the token the signal would buy.
   * Requires a fresh bilateral book; never enters on a missing/unilateral/stale target.
   */
  private resolveTargetSpreadGate(
    targetBook: TopOfBookData | null,
    nowMs: number,
  ):
    | { kind: 'ok'; spreadAbs: number }
    | { kind: 'abstain'; reason: 'illiquid_book' | 'stale_book'; detail?: string } {
    if (!targetBook) {
      return {
        kind: 'abstain',
        reason: 'illiquid_book',
        detail: 'target_book_missing',
      };
    }

    if (!isFreshBook(targetBook, nowMs, this.config.maxBookAgeMs)) {
      return {
        kind: 'abstain',
        reason: 'stale_book',
        detail: 'target_book_stale',
      };
    }

    if (!isBilateralBook(targetBook) || targetBook.spread == null) {
      return {
        kind: 'abstain',
        reason: 'illiquid_book',
        detail: 'target_book_unilateral',
      };
    }

    return { kind: 'ok', spreadAbs: targetBook.spread };
  }

  private logInsufficientCurveHistory(
    conditionId: string,
    candidate: 'YES' | 'NO',
    points: number,
    nowMs: number,
  ): void {
    const lastAt = this.lastInsufficientLogByCondition.get(conditionId) ?? 0;
    if (nowMs - lastAt < CURVE_INSUFFICIENT_LOG_INTERVAL_MS) {
      return;
    }

    const pruneBefore = nowMs - 2 * CURVE_INSUFFICIENT_LOG_INTERVAL_MS;
    for (const [id, ts] of this.lastInsufficientLogByCondition) {
      if (ts < pruneBefore) {
        this.lastInsufficientLogByCondition.delete(id);
      }
    }

    this.lastInsufficientLogByCondition.set(conditionId, nowMs);
    log.debug(
      {
        conditionId,
        candidate,
        points,
        lookbackMs: this.config.curveLookbackMs,
      },
      'curve filter enabled but insufficient mid history — fail-open',
    );
  }

  private selectPrice(
    gammaYesPrice: number,
    upBook: TopOfBookData | null,
    nowMs: number,
    conditionId: string,
  ): {
    price: number | null;
    priceSource: 'websocket' | 'gamma';
    abstainReason?: 'stale_book' | 'no_price_source';
  } {
    const freshBilateral =
      isBilateralBook(upBook) &&
      isFreshBook(upBook, nowMs, this.config.maxBookAgeMs);

    if (freshBilateral) {
      const wsMid = upBook.midPrice;
      const deviation = Math.abs(wsMid - gammaYesPrice);
      if (deviation >= this.config.warnPriceDeviation) {
        log.warn(
          { conditionId, wsMidPrice: wsMid, gammaYesPrice, deviation },
          'WS/Gamma price deviation (non-blocking, using WebSocket)',
        );
      }
      return { price: wsMid, priceSource: 'websocket' };
    }

    const bookStale =
      upBook != null && !isFreshBook(upBook, nowMs, this.config.maxBookAgeMs);

    if (
      typeof gammaYesPrice === 'number' &&
      Number.isFinite(gammaYesPrice) &&
      gammaYesPrice >= 0 &&
      gammaYesPrice <= 1
    ) {
      return { price: gammaYesPrice, priceSource: 'gamma' };
    }

    if (bookStale) {
      return { price: null, priceSource: 'gamma', abstainReason: 'stale_book' };
    }

    return {
      price: null,
      priceSource: 'gamma',
      abstainReason: 'no_price_source',
    };
  }

  private createSignal(
    market: MarketListItemDto,
    outcome: 'YES' | 'NO',
    yesPrice: number,
    threshold: number | null,
    spreadAbs: number | null,
    priceSource: 'websocket' | 'gamma',
    entryPriceBandEnabled: boolean,
  ): AlgoSignal | null {
    const assetId = outcome === 'YES' ? market.tokenIdYes : market.tokenIdNo;
    if (!assetId) return null;

    const priceDeviation = outcome === 'YES' ? yesPrice : 1 - yesPrice;
    const confidence = this.calculateConfidence(
      priceDeviation,
      spreadAbs,
    );

    return {
      conditionId: market.conditionId,
      assetId,
      outcome,
      side: 'BUY',
      confidence,
      reasons: this.buildReasons(
        outcome,
        yesPrice,
        threshold,
        spreadAbs,
        priceSource,
        entryPriceBandEnabled,
        this.config.entryPriceMin,
        this.config.entryPriceMax,
      ),
      strategyId: this.id,
      interval: market.interval ?? '',
    };
  }

  private calculateThreshold(spreadAbs: number | null): number {
    const { baseThreshold, spreadAdjustmentFactor, minSpreadAbsForAdjustment } =
      this.config;

    if (spreadAbs === null || spreadAbs < minSpreadAbsForAdjustment) {
      return baseThreshold;
    }

    return baseThreshold + spreadAbs * spreadAdjustmentFactor;
  }

  private calculateConfidence(
    priceDeviation: number,
    spreadAbs: number | null,
  ): number {
    const baseConfidence = (priceDeviation - 0.5) * 2;

    if (
      spreadAbs !== null &&
      spreadAbs > this.config.minSpreadAbsForAdjustment
    ) {
      const spreadPenalty = Math.min(0.3, spreadAbs);
      return clamp01(baseConfidence * (1 - spreadPenalty));
    }

    return clamp01(baseConfidence);
  }

  private buildReasons(
    outcome: 'YES' | 'NO',
    yesPrice: number,
    threshold: number | null,
    spreadAbs: number | null,
    priceSource: 'websocket' | 'gamma',
    entryPriceBandEnabled: boolean,
    entryPriceMin: number,
    entryPriceMax: number,
  ): string[] {
    const reasons: string[] = [];
    const entryPrice = outcome === 'YES' ? yesPrice : 1 - yesPrice;

    if (entryPriceBandEnabled) {
      reasons.push(
        `Entry price ${entryPrice.toFixed(4)} within band (${entryPriceMin}, ${entryPriceMax}) — buy ${outcome}`,
      );
      if (outcome === 'NO') {
        reasons.push(`YES price ${yesPrice.toFixed(4)}`);
      }
    } else if (threshold != null) {
      if (outcome === 'YES') {
        reasons.push(
          `YES price ${yesPrice.toFixed(4)} above ${threshold.toFixed(4)} threshold`,
        );
      } else {
        reasons.push(
          `YES price ${yesPrice.toFixed(4)} below ${(1 - threshold).toFixed(4)} threshold (buy NO)`,
        );
      }
    }

    if (spreadAbs !== null) {
      reasons.push(`spreadAbs ${spreadAbs.toFixed(4)}`);
    }

    reasons.push(`price source: ${priceSource}`);

    return reasons;
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
