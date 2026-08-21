import type { BacktestExitReason } from '@polywatch/core';

/** An open (or recently closed) backtest position held in the ledger. */
export interface LedgerPosition {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  side: 'YES';
  qty: number;
  entryPrice: number;
  entryAt: Date;
  /** Last known bid for mark-to-market (not peak). */
  markPrice: number;
  /** Running peak of closure PnL % (relative to invested amount) for trailing. */
  peakClosurePnl: number;
  fees: number;
  entryReason: string | null;
  meta: Record<string, unknown>;
}

export interface ClosedLedgerPosition {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  side: 'YES';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  entryAt: Date;
  exitAt: Date;
  entryReason: string | null;
  exitReason: BacktestExitReason;
  pnl: number;
  fees: number;
  meta: Record<string, unknown>;
}

/**
 * In-memory ledger for a single backtest run. Cash + open positions +
 * mark-to-market. Positions are flushed to the repository by the runner.
 */
export class Ledger {
  cash: number;
  private open = new Map<string, LedgerPosition>();
  private closed: ClosedLedgerPosition[] = [];

  constructor(initialCapital: number) {
    this.cash = initialCapital;
  }

  hasOpen(conditionId: string): boolean {
    return this.open.has(conditionId);
  }

  getOpen(conditionId: string): LedgerPosition | undefined {
    return this.open.get(conditionId);
  }

  openCount(): number {
    return this.open.size;
  }

  openPositions(): LedgerPosition[] {
    return Array.from(this.open.values());
  }

  isDuplicateOpen(conditionId: string): boolean {
    return this.open.has(conditionId);
  }

  /** Notional USDC tied up in open positions (cost basis). Optional strategy filter. */
  openExposure(strategyId?: string | null): number {
    let total = 0;
    for (const pos of this.open.values()) {
      if (strategyId !== undefined) {
        const posStrategy = (pos.meta?.strategyId as string | null | undefined) ?? null;
        if (posStrategy !== strategyId) continue;
      }
      total += pos.qty * pos.entryPrice;
    }
    return total;
  }

  /** Realized PnL for the UTC calendar day of `at` (negative = loss). Optional strategy filter. */
  dailyRealizedPnl(at: Date, strategyId?: string | null): number {
    const dayKey = at.toISOString().slice(0, 10);
    let total = 0;
    for (const pos of this.closed) {
      if (pos.exitAt.toISOString().slice(0, 10) !== dayKey) continue;
      if (strategyId !== undefined) {
        const posStrategy = (pos.meta?.strategyId as string | null | undefined) ?? null;
        if (posStrategy !== strategyId) continue;
      }
      total += pos.pnl;
    }
    return total;
  }

  openPosition(input: {
    conditionId: string;
    city?: string | null;
    targetDateIso?: string | null;
    qty: number;
    entryPrice: number;
    entryAt: Date;
    fees: number;
    entryReason?: string | null;
    meta?: Record<string, unknown>;
  }): void {
    if (this.open.has(input.conditionId)) {
      throw new Error(`ledger_duplicate_open:${input.conditionId}`);
    }
    this.cash -= input.qty * input.entryPrice + input.fees;
    this.open.set(input.conditionId, {
      conditionId: input.conditionId,
      city: input.city ?? null,
      targetDateIso: input.targetDateIso ?? null,
      side: 'YES',
      qty: input.qty,
      entryPrice: input.entryPrice,
      entryAt: input.entryAt,
      markPrice: input.entryPrice,
      // Initialize peak closure PnL from the entry fill (may be negative due to fees).
      peakClosurePnl:
        input.qty > 0
          ? (() => {
              const cb = input.entryPrice + input.fees / input.qty;
              return cb > 0 ? ((input.entryPrice - cb) / cb) * 100 : 0;
            })()
          : 0,
      fees: input.fees,
      entryReason: input.entryReason ?? null,
      meta: input.meta ?? {},
    });
  }

  /** Update mark price and running peak for trailing-stop evaluation. */
  updateMark(conditionId: string, bid: number): void {
    const pos = this.open.get(conditionId);
    if (!pos) return;
    pos.markPrice = bid;
    // Track the peak of the closure PnL (%) for percentage trailing-stop.
    if (pos.qty > 0) {
      const costBasis = pos.entryPrice + pos.fees / pos.qty;
      if (costBasis > 0) {
        const closurePnl = ((bid - costBasis) / costBasis) * 100;
        if (closurePnl > pos.peakClosurePnl) {
          pos.peakClosurePnl = closurePnl;
        }
      }
    }
  }

  /** Close an open position, realizing P&L. Returns the closed record. */
  closePosition(input: {
    conditionId: string;
    exitPrice: number;
    exitAt: Date;
    exitReason: BacktestExitReason;
    fees?: number;
  }): ClosedLedgerPosition {
    const pos = this.open.get(input.conditionId);
    if (!pos) {
      throw new Error(`ledger_close_missing:${input.conditionId}`);
    }
    const exitFees = input.fees ?? 0;
    const gross = pos.qty * input.exitPrice;
    const pnl = gross - pos.qty * pos.entryPrice - pos.fees - exitFees;
    this.cash += gross - exitFees;
    this.open.delete(input.conditionId);
    const closed: ClosedLedgerPosition = {
      conditionId: pos.conditionId,
      city: pos.city,
      targetDateIso: pos.targetDateIso,
      side: 'YES',
      qty: pos.qty,
      entryPrice: pos.entryPrice,
      exitPrice: input.exitPrice,
      entryAt: pos.entryAt,
      exitAt: input.exitAt,
      entryReason: pos.entryReason,
      exitReason: input.exitReason,
      pnl,
      fees: pos.fees + exitFees,
      meta: pos.meta,
    };
    this.closed.push(closed);
    return closed;
  }

  /** Mark-to-market equity: cash + unrealized value at current mark prices. */
  equityAt(_now: Date): { equity: number; cash: number; openPositions: number } {
    let unrealized = 0;
    for (const pos of this.open.values()) {
      unrealized += pos.qty * pos.markPrice;
    }
    return {
      equity: this.cash + unrealized,
      cash: this.cash,
      openPositions: this.open.size,
    };
  }

  closedPositions(): ClosedLedgerPosition[] {
    return this.closed;
  }

  allPositions(): (LedgerPosition | ClosedLedgerPosition)[] {
    return [...this.open.values(), ...this.closed];
  }
}
