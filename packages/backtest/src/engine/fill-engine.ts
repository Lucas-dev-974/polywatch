import { computeTakerFee, type PlatformFeeParams, type BacktestExitReason } from '@polywatch/core';

/** Fees for the whole market set (constant across a run). */
export const BACKTEST_PLATFORM_FEE: PlatformFeeParams = {
  feeRate: 0.03,
  feeExponent: 1,
};

export interface FillInput {
  conditionId: string;
  yesPrice: number;
  entryPusd: number;
  slippageBps: number;
  maxPositionSizePusd?: number;
  /** Sizing mode from the emitting strategy's bag (defaults to fixed_pusd). */
  sizingMode?: 'fixed_pusd' | 'fixed_shares';
  /** Fixed share count when sizingMode === 'fixed_shares'. */
  fixedShareCount?: number;
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
 *
 * Sizing honours the strategy's `sizingMode`:
 * - `fixed_pusd` (default): qty = cappedPusd / price
 * - `fixed_shares`: qty = min(fixedShareCount, budget/price), floored —
 *   mirrors `computeFixedSharesQuantity` in core/src/sizing/compute.ts.
 */
export function simulateWeatherEntryFill(input: FillInput): FillResult {
  const price = Math.min(1, input.yesPrice * (1 + input.slippageBps / 10_000));
  if (price <= 0) return { conditionId: input.conditionId, qty: 0, entryPrice: 0, fees: 0 };

  let qty: number;
  if (input.sizingMode === 'fixed_shares') {
    const maxSharesByBudget =
      Math.min(
        input.maxPositionSizePusd ?? Number.POSITIVE_INFINITY,
        input.entryPusd,
      ) / price;
    qty = Math.floor(Math.min(input.fixedShareCount ?? 0, maxSharesByBudget));
    // Miroir de computeFixedSharesQuantity : 0 tokens = pas d'entrée.
    // L'appelant doit vérifier qty > 0 avant d'ouvrir la position.
    if (qty <= 0) return { conditionId: input.conditionId, qty: 0, entryPrice: price, fees: 0 };
  } else {
    const cappedPusd = Math.min(
      input.entryPusd,
      input.maxPositionSizePusd ?? Number.POSITIVE_INFINITY,
    );
    qty = cappedPusd / price;
  }

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
  const price = Math.max(0, input.yesPrice * (1 - input.slippageBps / 10_000));
  const fees = computeTakerFee(input.qty, price, BACKTEST_PLATFORM_FEE);
  return { exitPrice: price, fees };
}

export type { BacktestExitReason };
