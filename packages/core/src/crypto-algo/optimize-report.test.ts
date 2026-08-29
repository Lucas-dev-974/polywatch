import { describe, expect, it } from 'vitest';
import {
  OPTIMIZE_REPORT_MIN_CLOSED,
  buildCryptoAlgoOptimizeReport,
  type OptimizeReportConfigInput,
  type OptimizeReportPositionInput,
} from './optimize-report.js';

const defaultConfig: OptimizeReportConfigInput = {
  cryptoAlgoEnabled: true,
  cryptoAlgoStrategies: '["naive-momentum"]',
  cryptoAlgoSlEnabled: true,
  cryptoAlgoTpEnabled: false,
  cryptoAlgoTrailingEnabled: false,
  cryptoAlgoSlPercent: 20,
  cryptoAlgoTpPercent: null,
  cryptoAlgoTrailingPercent: null,
  cryptoAlgoTrailingActivationPercent: null,
  cryptoAlgoPreCloseEnabled: false,
  cryptoAlgoPreCloseSeconds: null,
  cryptoAlgoPreCloseKeepEnabled: null,
  cryptoAlgoPreCloseKeepBidThreshold: null,
  slConfirmationTicks: 2,
  cryptoAlgoBaseThreshold: null,
  cryptoAlgoSizingMode: 'fixed_pusd',
  cryptoAlgoEntryPusdAmount: 10,
  cryptoAlgoEntryShareCount: null,
  simEntryPusdAmount: 5,
  simEntryShareCount: 5,
  simSizingMode: 'fixed_pusd',
};

function pos(
  partial: Partial<OptimizeReportPositionInput> &
    Pick<OptimizeReportPositionInput, 'id' | 'status'>,
): OptimizeReportPositionInput {
  return {
    closeReason: null,
    realizedPnl: 0,
    entryPrice: 0.6,
    entryBidVwap: 0.59,
    peakClosurePnlPercent: null,
    openedAt: new Date('2026-07-10T10:00:00Z'),
    closedAt: new Date('2026-07-10T10:05:00Z'),
    marketSlug: 'btc-updown-5m-123',
    ...partial,
  };
}

function makeClosedSlBatch(n: number, peak: number, pnl: number): OptimizeReportPositionInput[] {
  return Array.from({ length: n }, (_, i) =>
    pos({
      id: i + 1,
      status: 'closed',
      closeReason: 'SL',
      realizedPnl: pnl,
      peakClosurePnlPercent: peak,
    }),
  );
}

function makeClosedRedBatch(n: number, pnl: number): OptimizeReportPositionInput[] {
  return Array.from({ length: n }, (_, i) =>
    pos({
      id: 1000 + i,
      status: 'closed',
      closeReason: 'REDEMPTION',
      realizedPnl: pnl,
      peakClosurePnlPercent: 50,
    }),
  );
}

describe('buildCryptoAlgoOptimizeReport', () => {
  it('computes winRateClosed from closed positions only', () => {
    const report = buildCryptoAlgoOptimizeReport({
      positions: [
        pos({ id: 1, status: 'closed', closeReason: 'REDEMPTION', realizedPnl: 2 }),
        pos({ id: 2, status: 'closed', closeReason: 'SL', realizedPnl: -2 }),
        pos({ id: 3, status: 'cancelled' }),
        pos({ id: 4, status: 'open', realizedPnl: -1 }),
      ],
      config: defaultConfig,
      balance: { cash: 800, baseline: 1000 },
      exitAttempts: [],
      tickCoverage: { closedWithTicks: 2, closedTotal: 2, avgTicksWhenPresent: 100 },
    });
    expect(report.totals.closed).toBe(2);
    expect(report.totals.winRateClosed).toBe(50);
    expect(report.totals.cancelled).toBe(1);
    expect(report.totals.openLike).toBe(1);
    expect(report.totals.realizedAlgo).toBe(0);
  });

  it('returns neutral verdict and no levers when sample too small', () => {
    const report = buildCryptoAlgoOptimizeReport({
      positions: makeClosedSlBatch(5, -5, -2),
      config: defaultConfig,
      balance: { cash: 900, baseline: 1000 },
      exitAttempts: [],
      tickCoverage: { closedWithTicks: 5, closedTotal: 5, avgTicksWhenPresent: 50 },
    });
    expect(report.verdict.tone).toBe('neutral');
    expect(report.levers).toHaveLength(0);
    expect(report.verdict.detail).toContain(String(OPTIMIZE_REPORT_MIN_CLOSED));
  });

  it('does not include counterfactual dollar recovery in levers', () => {
    const positions = [
      ...makeClosedSlBatch(30, 35, -2.5),
      ...makeClosedRedBatch(25, 2.5),
    ];
    const report = buildCryptoAlgoOptimizeReport({
      positions,
      config: defaultConfig,
      balance: { cash: 700, baseline: 1000 },
      exitAttempts: [{ kind: 'emit_blocked', closeReason: 'SL', blockReason: 'x', error: null, count: 200 }],
      tickCoverage: { closedWithTicks: 55, closedTotal: 55, avgTicksWhenPresent: 200 },
    });
    for (const lever of report.levers) {
      expect(lever.detail).not.toMatch(/récupérable|contrefactuel|swing/i);
      expect(lever.detail).not.toMatch(/\+\d{3}\s*\$/);
    }
    expect(report.whipsaw.count).toBe(30);
    expect(report.byCloseReason.some((r) => r.closeReason === 'SL')).toBe(true);
  });

  it('aggregates entry buckets and assets', () => {
    const report = buildCryptoAlgoOptimizeReport({
      positions: [
        pos({
          id: 1,
          status: 'closed',
          closeReason: 'SL',
          entryPrice: 0.58,
          realizedPnl: -1,
          marketSlug: 'eth-updown-5m-1',
        }),
        pos({
          id: 2,
          status: 'closed',
          closeReason: 'REDEMPTION',
          entryPrice: 0.52,
          realizedPnl: 2,
          marketSlug: 'xrp-updown-5m-1',
        }),
      ],
      config: defaultConfig,
      balance: { cash: 900, baseline: 1000 },
      exitAttempts: [],
      tickCoverage: { closedWithTicks: 2, closedTotal: 2, avgTicksWhenPresent: 10 },
    });
    expect(report.entryBuckets.some((b) => b.bucket === 'b_0.55-0.60')).toBe(true);
    expect(report.byAsset.find((a) => a.asset === 'eth')?.slCount).toBe(1);
    expect(report.byAsset.find((a) => a.asset === 'xrp')?.redemptionWins).toBe(1);
  });

  it('marks config as live', () => {
    const report = buildCryptoAlgoOptimizeReport({
      positions: [],
      config: defaultConfig,
      balance: { cash: 1000, baseline: 1000 },
      exitAttempts: [],
      tickCoverage: { closedWithTicks: 0, closedTotal: 0, avgTicksWhenPresent: null },
    });
    expect(report.config.isLiveConfig).toBe(true);
    expect(report.balance.note).toBe('sim_global');
  });
});
