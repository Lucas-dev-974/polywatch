import type { MoveEventDto } from '../types/index.js';
import type { Market } from '../entities/Market.js';

export interface SignalScore {
  /** 0.0 to 1.0, where 1.0 is maximum confidence. */
  score: number;
  /** Multiplier to apply to the target spend/quantity. */
  multiplier: number;
  reasons: string[];
}

export interface SignalScoreContext {
  event: MoveEventDto;
  market: Market;
  currentSpread: number;
  hoursToExpiry: number;
  traderStats?: { winRate: number; profitFactor: number };
}

const BASE_SCORE = 0.5;
const MIN_SCORE = 0.1;
const MAX_SCORE = 1.0;

const PROFIT_FACTOR_HIGH = 2.0;
const PROFIT_FACTOR_LOW = 1.1;
const WIN_RATE_HIGH = 0.65;
const WIN_RATE_LOW = 0.45;

const SPREAD_TIGHT = 0.01;
const SPREAD_WIDE = 0.05;

const EXPIRY_HOURS_DANGEROUS = 1;
const EXPIRY_HOURS_SHORT = 24;

function adjustForTraderStats(score: number, reasons: string[], traderStats?: { winRate: number; profitFactor: number }): number {
  if (!traderStats) return score;

  if (traderStats.profitFactor > PROFIT_FACTOR_HIGH) {
    score += 0.2;
    reasons.push('High profit factor trader');
  } else if (traderStats.profitFactor < PROFIT_FACTOR_LOW) {
    score -= 0.2;
    reasons.push('Low profit factor trader');
  }

  if (traderStats.winRate > WIN_RATE_HIGH) {
    score += 0.1;
    reasons.push('High win rate trader');
  } else if (traderStats.winRate < WIN_RATE_LOW) {
    score -= 0.1;
    reasons.push('Low win rate trader');
  }

  return score;
}

function adjustForSpread(score: number, reasons: string[], currentSpread: number): number {
  if (currentSpread < SPREAD_TIGHT) {
    score += 0.1;
    reasons.push('Tight spread');
  } else if (currentSpread > SPREAD_WIDE) {
    score -= 0.2;
    reasons.push('Wide spread');
  }
  return score;
}

function adjustForTiming(score: number, reasons: string[], hoursToExpiry: number): number {
  if (hoursToExpiry < EXPIRY_HOURS_DANGEROUS) {
    score -= 0.3;
    reasons.push('Dangerously close to expiry');
  } else if (hoursToExpiry < EXPIRY_HOURS_SHORT) {
    score -= 0.1;
    reasons.push('Short time to expiry');
  }
  return score;
}

export function computeSignalScore(ctx: SignalScoreContext): SignalScore {
  const reasons: string[] = [];

  let score = BASE_SCORE;
  score = adjustForTraderStats(score, reasons, ctx.traderStats);
  score = adjustForSpread(score, reasons, ctx.currentSpread);
  score = adjustForTiming(score, reasons, ctx.hoursToExpiry);
  score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));

  return {
    score,
    multiplier: score,
    reasons,
  };
}
