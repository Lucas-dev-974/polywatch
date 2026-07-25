import type { ModeSizingParams } from '../risk/policy.js';
import type { TradingMode } from '../types/index.js';
import { computeTargetQuantity, type SizingInput } from './compute.js';
import type { SignalScore } from './signal-scorer.js';

export interface EntrySizingBalances {
  cash: number;
  /** Capital total pour le ratio proportional_capital (equity sim, cash réel). */
  capitalForRatio?: number;
}

export function resolveCapitalForRatio(
  sizingMode: string,
  balances: EntrySizingBalances,
): number | undefined {
  if (sizingMode !== 'proportional_capital') return undefined;
  return balances.capitalForRatio ?? balances.cash;
}

export function buildEntrySizingInput(params: {
  sizing: ModeSizingParams;
  askVwap: number;
  traderDelta: number;
  previousTraderSize: number;
  balances: EntrySizingBalances;
  traderPortfolioValue?: number;
  maxPositionSizeUsdc: number;
  signalScore?: SignalScore;
  stopDistance?: number;
}): SizingInput {
  const { sizing, balances, signalScore } = params;
  return {
    sizingMode: sizing.sizingMode,
    copyRatio: sizing.copyRatio,
    fixedUsdcAmount: sizing.fixedUsdcAmount,
    fixedShareCount: sizing.fixedShareCount,
    kellyFraction: sizing.kellyFraction,
    riskBudgetUsdc: sizing.riskBudgetUsdc,
    winProbability: sizing.defaultWinProbability,
    stopDistance: params.stopDistance,
    signalMultiplier: sizing.signalScoreSizingEnabled
      ? signalScore?.multiplier
      : undefined,
    traderDeltaSize: params.traderDelta,
    traderSizeBeforeMove: params.previousTraderSize,
    ourQuantity: 0,
    executableAskVwap: params.askVwap,
    userBalance: balances.cash,
    userCapital: resolveCapitalForRatio(sizing.sizingMode, balances),
    traderBalance: params.traderPortfolioValue,
    maxPositionSizeUsdc: params.maxPositionSizeUsdc,
  };
}

export function computeEntryTargetQuantity(params: {
  sizing: ModeSizingParams;
  askVwap: number;
  traderDelta: number;
  previousTraderSize: number;
  balances: EntrySizingBalances;
  traderPortfolioValue?: number;
  maxPositionSizeUsdc: number;
  signalScore?: SignalScore;
  stopDistance?: number;
}): number | null {
  return computeTargetQuantity(buildEntrySizingInput(params));
}

export function requiresTraderPortfolioValue(sizingMode: string): boolean {
  return sizingMode === 'proportional_capital';
}

export async function resolveSimEntryBalances(
  simulationService: {
    getCashAmount(): Promise<number>;
    getSnapshot(): Promise<{ equity: number }>;
  },
  sizingMode: string,
): Promise<EntrySizingBalances> {
  const cash = await simulationService.getCashAmount();
  if (sizingMode !== 'proportional_capital') {
    return { cash };
  }
  const snapshot = await simulationService.getSnapshot();
  return { cash, capitalForRatio: snapshot.equity };
}

export function resolveRealEntryBalances(
  sizingMode: string,
  cash: number,
): EntrySizingBalances {
  if (sizingMode !== 'proportional_capital') {
    return { cash };
  }
  return { cash, capitalForRatio: cash };
}

export async function resolveEntryBalances(
  mode: TradingMode,
  sizingMode: string,
  simulationService: {
    getCashAmount(): Promise<number>;
    getSnapshot(): Promise<{ equity: number }>;
  },
  realCashOverride?: number,
): Promise<EntrySizingBalances> {
  if (mode === 'sim') {
    return resolveSimEntryBalances(simulationService, sizingMode);
  }
  if (realCashOverride === undefined) {
    throw new Error('real_cash_unavailable');
  }
  return resolveRealEntryBalances(sizingMode, realCashOverride);
}
