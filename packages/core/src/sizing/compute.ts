import type { MoveEventType, SizingMode } from '../types/index.js';
import type { SignalScore } from './signal-scorer.js';
import { MIN_ORDER_SHARES } from './constants.js';

export interface SizingInput {
  sizingMode: SizingMode;
  copyRatio: number;
  fixedUsdcAmount: number | null;
  /** Fixed share count for `fixed_shares` sizing. */
  fixedShareCount?: number;
  /** Kelly fractional sizing: fraction of full Kelly to use (0..1). */
  kellyFraction?: number;
  /** Risk-based sizing: fixed risk budget per trade in USDC. */
  riskBudgetUsdc?: number;
  /** Estimated probability of winning (for Kelly). Defaults to 0.55. */
  winProbability?: number;
  /** Stop-loss distance in price terms (entry - stop), for risk-based sizing. */
  stopDistance?: number;
  /** Signal quality multiplier (0..1). Applied to all sizing modes. */
  signalMultiplier?: number;
  traderDeltaSize: number;
  traderSizeBeforeMove: number;
  ourQuantity: number;
  executableAskVwap: number;
  /** Available cash — caps max spend. */
  userBalance: number;
  /** Total capital for proportional sizing (defaults to userBalance). */
  userCapital?: number;
  traderBalance?: number;
  maxPositionSizeUsdc: number;
}

const DEFAULT_WIN_PROBABILITY = 0.55;

function maxSpendUsdc(input: SizingInput): number {
  return Math.min(input.maxPositionSizeUsdc, input.userBalance);
}

/**
 * Compute the Kelly fraction target spend.
 *
 * For a binary market with price p:
 * - b = (1 - p) / p   (net odds received per unit bet)
 * - f* = p - q / b = (p * b - (1 - p)) / b
 *
 * We use a fractional Kelly (e.g. 0.25) to reduce volatility.
 */
function computeKellySpend(input: SizingInput): number | null {
  const { executableAskVwap, userBalance, kellyFraction, winProbability } = input;
  const fraction = kellyFraction ?? 0.25;
  if (fraction <= 0 || executableAskVwap <= 0) return null;

  const p = Math.max(0.01, Math.min(0.99, winProbability ?? DEFAULT_WIN_PROBABILITY));
  const q = 1 - p;
  const b = (1 - p) / p;
  if (b <= 0) return null;

  const fullKelly = (p * b - q) / b;
  const fractionalKelly = fullKelly * fraction;

  if (fractionalKelly <= 0) return null;

  return Math.min(fractionalKelly * userBalance, maxSpendUsdc(input));
}

/**
 * Risk-based sizing: risk a fixed budget on this trade.
 *
 * quantity = riskBudget / (entryPrice - stopPrice)
 */
function computeRiskBasedSpend(input: SizingInput): number | null {
  const { executableAskVwap, riskBudgetUsdc, stopDistance } = input;
  const budget = riskBudgetUsdc ?? 0;
  if (budget <= 0 || executableAskVwap <= 0) return null;

  const distance = stopDistance ?? executableAskVwap;
  const riskFraction = distance / executableAskVwap;
  if (riskFraction <= 0) return null;

  return Math.min(budget / riskFraction, maxSpendUsdc(input));
}

type SpendStrategy = (input: SizingInput) => number | null;

function fixedUsdcStrategy(input: SizingInput): number | null {
  const amount = input.fixedUsdcAmount;
  if (!amount || amount <= 0) return null;
  return amount;
}

function proportionalCapitalStrategy(input: SizingInput): number | null {
  const capital = input.userCapital ?? input.userBalance;
  const traderBalance = input.traderBalance;
  if (!traderBalance || traderBalance <= 0 || capital <= 0) return null;
  return (capital / traderBalance) * input.traderDeltaSize * input.executableAskVwap;
}

function fixedRatioStrategy(input: SizingInput): number | null {
  if (input.traderDeltaSize <= 0) return null;
  return input.traderDeltaSize * input.copyRatio * input.executableAskVwap;
}

type SpendSizingMode = Exclude<SizingMode, 'fixed_shares'>;

const SPEND_STRATEGIES: Record<SpendSizingMode, SpendStrategy> = {
  fixed_usdc: fixedUsdcStrategy,
  fixed_ratio: fixedRatioStrategy,
  proportional_capital: proportionalCapitalStrategy,
  kelly_fractional: computeKellySpend,
  risk_based: computeRiskBasedSpend,
};

function computeBaseSpend(input: SizingInput): number | null {
  if (input.sizingMode === 'fixed_shares') return null;
  const strategy = SPEND_STRATEGIES[input.sizingMode];
  if (!strategy) return null;
  return strategy(input);
}

function applySignalMultiplier(value: number, multiplier?: number): number {
  if (multiplier === undefined) return value;
  return value * Math.max(0.1, Math.min(1.0, multiplier));
}

function computeFixedSharesQuantity(input: SizingInput): number | null {
  const base = input.fixedShareCount ?? 0;
  if (base <= 0 || input.executableAskVwap <= 0) return null;

  let targetShares = applySignalMultiplier(base, input.signalMultiplier);
  const maxSharesByBudget = maxSpendUsdc(input) / input.executableAskVwap;
  targetShares = Math.min(targetShares, maxSharesByBudget);
  targetShares = Math.floor(targetShares);

  return targetShares >= MIN_ORDER_SHARES ? targetShares : null;
}

export function computeTargetQuantity(input: SizingInput): number | null {
  if (input.executableAskVwap <= 0) return null;

  if (input.sizingMode === 'fixed_shares') {
    return computeFixedSharesQuantity(input);
  }

  let targetSpendUsdc = computeBaseSpend(input);
  if (targetSpendUsdc === null || targetSpendUsdc <= 0) return null;

  targetSpendUsdc = applySignalMultiplier(targetSpendUsdc, input.signalMultiplier);
  targetSpendUsdc = Math.min(targetSpendUsdc, maxSpendUsdc(input));

  const targetQuantity = targetSpendUsdc / input.executableAskVwap;
  return targetQuantity >= MIN_ORDER_SHARES ? targetQuantity : null;
}

export function computeSellQuantity(
  eventType: MoveEventType,
  ourQuantity: number,
  traderDeltaSize: number,
  traderSizeBeforeMove: number,
): number {
  if (eventType === 'CLOSED') return ourQuantity;
  if (traderSizeBeforeMove <= 0) return 0;
  return ourQuantity * (traderDeltaSize / traderSizeBeforeMove);
}
