import { describe, expect, it } from 'vitest';
import { buildRecommendedCryptoAlgoConfig } from './optimize-report-recommendations.js';
import type { CryptoAlgoOptimizeReport } from './optimize-report.js';

function baseReport(
  overrides: Partial<CryptoAlgoOptimizeReport> = {},
): CryptoAlgoOptimizeReport {
  return {
    generatedAt: new Date().toISOString(),
    balance: { cash: 800, baseline: 1000, note: 'sim_global' },
    config: {
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
      isLiveConfig: true,
    },
    totals: {
      all: 100,
      closed: 50,
      cancelled: 40,
      openLike: 10,
      realizedAlgo: -100,
      winRateClosed: 40,
      cancelledPct: 40,
    },
    byCloseReason: [
      {
        closeReason: 'SL',
        count: 30,
        sumPnl: -500,
        avgPnl: -16.67,
        wins: 1,
        losses: 29,
        avgPeakPct: 10,
        avgDurationSec: 100,
      },
      {
        closeReason: 'REDEMPTION',
        count: 20,
        sumPnl: 400,
        avgPnl: 20,
        wins: 18,
        losses: 2,
        avgPeakPct: 50,
        avgDurationSec: 600,
      },
    ],
    slPeakBuckets: [],
    whipsaw: { count: 15, sumPnl: -80, avgPeakPct: 40 },
    trailingOpportunity: { count: 25, sumPnl: -120, avgPeakPct: 30 },
    entryBuckets: [
      {
        bucket: 'b_0.55-0.60',
        count: 40,
        sumPnl: -80,
        avgPnl: -2,
        wins: 10,
        slPct: 60,
        redemptionWinPct: 30,
      },
    ],
    byAsset: [
      {
        asset: 'eth',
        closed: 25,
        sumPnl: -50,
        slCount: 15,
        redemptionWins: 8,
        redemptionLosses: 6,
      },
    ],
    exitAttempts: [],
    tickCoverage: { closedWithTicks: 50, closedTotal: 50, avgTicksWhenPresent: 200 },
    verdict: { tone: 'danger', title: 'SL détruit le edge', detail: 'test' },
    levers: [],
    recommendedConfig: { applicable: false, changes: [], patch: {} },
    ...overrides,
  };
}

describe('buildRecommendedCryptoAlgoConfig', () => {
  it('returns empty when sample too small', () => {
    const rec = buildRecommendedCryptoAlgoConfig(
      baseReport({ totals: { ...baseReport().totals, closed: 5 } }),
    );
    expect(rec.applicable).toBe(false);
    expect(rec.changes).toHaveLength(0);
  });

  it('proposes SL widen, trailing and pre-close from metrics', () => {
    const rec = buildRecommendedCryptoAlgoConfig(baseReport());
    expect(rec.applicable).toBe(true);
    expect(rec.patch.cryptoAlgoSlPercent).toBe(32);
    expect(rec.patch.cryptoAlgoTrailingEnabled).toBe(true);
    expect(rec.patch.cryptoAlgoPreCloseEnabled).toBe(true);
    expect(rec.changes.some((c) => c.field === 'cryptoAlgoSlPercent')).toBe(true);
  });

  it('skips changes already at target', () => {
    const rec = buildRecommendedCryptoAlgoConfig(
      baseReport({
        config: {
          ...baseReport().config,
          cryptoAlgoSlPercent: 32,
          cryptoAlgoTrailingEnabled: true,
          cryptoAlgoTrailingActivationPercent: 12,
          cryptoAlgoTrailingPercent: 10,
          cryptoAlgoPreCloseEnabled: true,
          cryptoAlgoPreCloseSeconds: 45,
          cryptoAlgoPreCloseKeepEnabled: true,
          cryptoAlgoPreCloseKeepBidThreshold: 0.80,
          cryptoAlgoBaseThreshold: 0.62,
        },
        whipsaw: { count: 0, sumPnl: 0, avgPeakPct: null },
        trailingOpportunity: { count: 0, sumPnl: 0, avgPeakPct: null },
        byCloseReason: [
          {
            closeReason: 'REDEMPTION',
            count: 20,
            sumPnl: 100,
            avgPnl: 5,
            wins: 20,
            losses: 0,
            avgPeakPct: 50,
            avgDurationSec: 600,
          },
        ],
        byAsset: [],
        entryBuckets: [],
      }),
    );
    expect(rec.applicable).toBe(false);
  });
});
