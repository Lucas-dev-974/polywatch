import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger.js';
import { computeStats, computeMaxDrawdown, type EquitySample } from './stats.js';

describe('Ledger', () => {
  it('opens and closes a position, realizing P&L', () => {
    const ledger = new Ledger(1000);
    const at = new Date('2026-01-01T00:00:00.000Z');
    ledger.openPosition({
      conditionId: 'c1',
      city: 'london',
      qty: 100,
      entryPrice: 0.5,
      entryAt: at,
      fees: 0.02,
      entryReason: 'signal',
    });
    expect(ledger.openCount()).toBe(1);
    expect(ledger.isDuplicateOpen('c1')).toBe(true);

    const closed = ledger.closePosition({
      conditionId: 'c1',
      exitPrice: 0.6,
      exitAt: new Date('2026-01-01T01:00:00.000Z'),
      exitReason: 'TP',
      fees: 0.01,
    });
    // gross 100*0.6=60 - 100*0.5=50 - entry fee 0.02 - exit fee 0.01
    expect(closed.pnl).toBeCloseTo(9.97, 5);
    expect(ledger.openCount()).toBe(0);
    // cash = 1000 - (50+0.02) + (60-0.01)
    expect(ledger.cash).toBeCloseTo(1009.97, 5);
  });

  it('marks-to-market equity from open positions via current markPrice', () => {
    const ledger = new Ledger(1000);
    const at = new Date('2026-01-01T00:00:00.000Z');
    ledger.openPosition({ conditionId: 'c1', qty: 100, entryPrice: 0.5, entryAt: at, fees: 0 });
    ledger.updateMark('c1', 0.7);
    ledger.updateMark('c1', 0.55);
    const snapshot = ledger.equityAt(at);
    // cash = 950; unrealized at current mark 0.55 = 55; equity = 1005
    expect(snapshot.cash).toBeCloseTo(950, 5);
    expect(snapshot.equity).toBeCloseTo(1005, 5);
    expect(snapshot.openPositions).toBe(1);
  });

  it('stores entryReason separately from meta detail', () => {
    const ledger = new Ledger(1000);
    const at = new Date('2026-01-01T00:00:00.000Z');
    ledger.openPosition({
      conditionId: 'c1',
      qty: 10,
      entryPrice: 0.5,
      entryAt: at,
      fees: 0,
      entryReason: 'replay_signal',
      meta: { detailReasons: 'edge high' },
    });
    const closed = ledger.closePosition({
      conditionId: 'c1',
      exitPrice: 0.6,
      exitAt: new Date('2026-01-01T01:00:00.000Z'),
      exitReason: 'TP',
    });
    expect(closed.entryReason).toBe('replay_signal');
  });

  it('rejects duplicate open', () => {
    const ledger = new Ledger(100);
    const at = new Date();
    ledger.openPosition({ conditionId: 'c1', qty: 1, entryPrice: 0.5, entryAt: at, fees: 0 });
    expect(() =>
      ledger.openPosition({ conditionId: 'c1', qty: 1, entryPrice: 0.5, entryAt: at, fees: 0 }),
    ).toThrow('ledger_duplicate_open');
  });

  it('rejects closing a missing position', () => {
    const ledger = new Ledger(100);
    expect(() =>
      ledger.closePosition({
        conditionId: 'nope',
        exitPrice: 1,
        exitAt: new Date(),
        exitReason: 'SL',
      }),
    ).toThrow('ledger_close_missing');
  });
});

describe('computeStats', () => {
  function closed(pos: { pnl: number; ms: number; reason: string; city?: string }) {
    return {
      conditionId: pos.reason + pos.pnl,
      city: pos.city ?? 'london',
      side: 'YES' as const,
      qty: 1,
      entryPrice: 0.5,
      exitPrice: 0.5 + pos.pnl,
      entryAt: new Date(0),
      exitAt: new Date(pos.ms),
      entryReason: null,
      exitReason: pos.reason as never,
      pnl: pos.pnl,
      fees: 0,
      meta: {},
    };
  }

  it('computes win rate, profit factor and holding', () => {
    const closedPositions = [
      closed({ pnl: 10, ms: 1000, reason: 'TP' }),
      closed({ pnl: -5, ms: 2000, reason: 'SL' }),
      closed({ pnl: 10, ms: 3000, reason: 'TP' }),
    ];
    const stats = computeStats(closedPositions, 1000, 1015, []);
    expect(stats.totalTrades).toBe(3);
    expect(stats.winRate).toBeCloseTo(2 / 3, 5);
    expect(stats.avgWin).toBeCloseTo(10, 5);
    expect(stats.avgLoss).toBeCloseTo(-5, 5);
    expect(stats.profitFactor).toBeCloseTo(20 / 5, 5);
    expect(stats.expectancy).toBeCloseTo(15 / 3, 5);
    expect(stats.avgHoldingMs).toBeCloseTo(2000, 5);
    expect(stats.byExitReason).toEqual({ TP: 2, SL: 1 });
  });

  it('handles empty trade set', () => {
    const stats = computeStats([], 1000, 1000, []);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBe(0);
    expect(stats.expectancy).toBe(0);
  });

  it('reports infinite profit factor on no losses', () => {
    const stats = computeStats([closed({ pnl: 5, ms: 1000, reason: 'TP' })], 1000, 1005, []);
    expect(stats.profitFactor).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('computeMaxDrawdown', () => {
  it('computes drawdown over an equity series', () => {
    const samples: EquitySample[] = [
      { t: new Date(0), equity: 1000, cash: 1000, openPositions: 0 },
      { t: new Date(1), equity: 1100, cash: 1100, openPositions: 0 },
      { t: new Date(2), equity: 900, cash: 900, openPositions: 0 },
      { t: new Date(3), equity: 950, cash: 950, openPositions: 0 },
    ];
    // peak 1100, trough 900 → dd = 200/1100
    expect(computeMaxDrawdown(samples)).toBeCloseTo(200 / 1100, 5);
  });

  it('returns 0 when equity only rises', () => {
    const samples: EquitySample[] = [
      { t: new Date(0), equity: 1000, cash: 1000, openPositions: 0 },
      { t: new Date(1), equity: 1200, cash: 1200, openPositions: 0 },
    ];
    expect(computeMaxDrawdown(samples)).toBe(0);
  });
});
