import type { ClosedLedgerPosition } from './ledger.js';
import type { BacktestRunStats } from '@polywatch/core';

export interface EquitySample {
  t: Date;
  equity: number;
  cash: number;
  openPositions: number;
}

/** Max drawdown (positive value) over an equity series. */
export function computeMaxDrawdown(equitySamples: EquitySample[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const s of equitySamples) {
    if (s.equity > peak) peak = s.equity;
    if (peak > 0) {
      const dd = (peak - s.equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

/**
 * Computes aggregate metrics from closed positions.
 */
export function computeStats(
  closed: ClosedLedgerPosition[],
  initialCapital: number,
  finalEquity: number,
  equitySamples: EquitySample[],
): BacktestRunStats {
  const totalTrades = closed.length;
  const wins = closed.filter((p) => p.pnl > 0);
  // pnl === 0 (breakeven) n'est ni un win ni un loss : exclu de avgLoss et de grossLoss.
  const losses = closed.filter((p) => p.pnl < 0);

  const totalPnl = closed.reduce((s, p) => s + p.pnl, 0);
  const pnlPct = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;

  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
  const grossWin = wins.reduce((s, p) => s + p.pnl, 0);
  const grossLoss = losses.reduce((s, p) => s + p.pnl, 0);
  // Infinity is not JSON-safe (becomes null). Encode "no losses" as null.
  const profitFactor: number | null =
    grossLoss !== 0
      ? grossWin / Math.abs(grossLoss)
      : grossWin > 0
        ? null
        : 0;
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const expectancy = totalTrades > 0 ? totalPnl / totalTrades : 0;

  const avgHoldingMs =
    totalTrades > 0
      ? closed.reduce((s, p) => s + (p.exitAt.getTime() - p.entryAt.getTime()), 0) / totalTrades
      : 0;

  const byExitReason: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const p of closed) {
    byExitReason[p.exitReason] = (byExitReason[p.exitReason] ?? 0) + 1;
    const key = p.city ?? 'unknown';
    byCity[key] = (byCity[key] ?? 0) + 1;
  }

  return {
    totalPnl,
    pnlPct,
    finalEquity,
    maxDrawdown: computeMaxDrawdown(equitySamples),
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    totalTrades,
    avgHoldingMs,
    byExitReason,
    byCity,
  };
}
