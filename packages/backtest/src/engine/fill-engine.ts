import { computeTakerFee, type PlatformFeeParams, type BacktestExitReason } from '@polywatch/core';

/** Fees for the whole market set (constant across a run). */
export const BACKTEST_PLATFORM_FEE: PlatformFeeParams = {
  feeRate: 0.03,
  feeExponent: 1,
};

export interface FillInput {
  conditionId: string;
  city?: string | null;
  yesPrice: number;
  entryUsdc: number;
  entryAt: Date;
  slippageBps: number;
  maxPositionSizeUsdc?: number;
  entryReason?: string | null;
  meta?: Record<string, unknown>;
}

export interface FillResult {
  conditionId: string;
  qty: number;
  entryPrice: number;
  fees: number;
}

/**
 * Simulates a buy-YES fill at the recorded yes price plus a synthetic
 * slippage buffer. No book depth is available, so fills are not capped by
 * real liquidity — this is flagged as a fidelity warning by the runner.
 */
export function simulateWeatherEntryFill(input: FillInput): FillResult {
  const price = input.yesPrice * (1 + input.slippageBps / 10_000);
  const cappedUsdc = Math.min(
    input.entryUsdc,
    input.maxPositionSizeUsdc ?? Number.POSITIVE_INFINITY,
  );
  const qty = cappedUsdc / price;
  const fees = computeTakerFee(qty, price, BACKTEST_PLATFORM_FEE);
  return { conditionId: input.conditionId, qty, entryPrice: price, fees };
}

/**
 * Simulates a sell-YES exit fill at the recorded yes price minus slippage.
 * Returns the net proceeds after fees. Used by the exit manager.
 */
export function simulateWeatherExitFill(input: {
  qty: number;
  yesPrice: number;
  slippageBps: number;
}): { exitPrice: number; fees: number } {
  const price = input.yesPrice * (1 - input.slippageBps / 10_000);
  const fees = computeTakerFee(input.qty, price, BACKTEST_PLATFORM_FEE);
  return { exitPrice: price, fees };
}

export type { BacktestExitReason };
