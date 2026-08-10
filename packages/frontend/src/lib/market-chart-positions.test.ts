import { describe, expect, it } from 'vitest';
import type { AlgoSurveillanceSnapshot } from './algo-surveillance';
import {
  formatChartPositionSelectorLabel,
  hasUsableEntryBidVwap,
  listChartPositions,
  resolveActiveChartPosition,
  type MarketChartContext,
} from './market-chart';
import { surveillanceToMarketChartContext } from './surveillance-market-chart';

function baseSnapshot(
  overrides: Partial<AlgoSurveillanceSnapshot> = {},
): AlgoSurveillanceSnapshot {
  return {
    id: 1,
    conditionId: 'cond-1',
    question: 'BTC Up or Down',
    cryptoSymbol: 'BTC',
    interval: '5m',
    slug: null,
    marketStartAt: '2026-01-01T00:00:00.000Z',
    marketEndAt: '2026-01-01T00:05:00.000Z',
    openUpPrice: 0.5,
    openDownPrice: 0.5,
    openCapturedAt: null,
    closeUpPrice: null,
    closeDownPrice: null,
    closeCapturedAt: null,
    winningOutcome: null,
    unresolvedAt: null,
    positions: [],
    ...overrides,
  };
}

describe('resolveActiveChartPosition', () => {
  it('uses chartPositions as sole source when present', () => {
    const ctx: MarketChartContext = {
      conditionId: 'c',
      copiedPositionId: 1,
      entryBidVwap: 0.99,
      chartPositions: [
        {
          id: 1,
          outcome: 'Up',
          mode: 'sim',
          status: 'Ouverte',
          assetId: 'a1',
          entryPrice: 0.55,
          entryBidVwap: 0.54,
          slBidPoints: 0.1,
          tpBidPoints: 0.12,
          exitBidVwap: null,
          openedAt: null,
          closedAt: null,
          positionQuantity: 5,
        },
        {
          id: 2,
          outcome: 'Down',
          mode: 'real',
          status: 'Clôturée',
          assetId: 'a2',
          entryPrice: 0.4,
          entryBidVwap: 0.39,
          slBidPoints: 0.1,
          tpBidPoints: null,
          exitBidVwap: 0.45,
          openedAt: null,
          closedAt: '2026-01-01T00:04:00.000Z',
          positionQuantity: 3,
        },
      ],
    };

    const active = resolveActiveChartPosition(ctx, 2);
    expect(active?.id).toBe(2);
    expect(active?.entryBidVwap).toBe(0.39);
    expect(active?.exitBidVwap).toBe(0.45);
    expect(active?.assetId).toBe('a2');
  });

  it('falls back to flat fields when chartPositions is empty', () => {
    const ctx: MarketChartContext = {
      conditionId: 'c',
      copiedPositionId: 9,
      assetId: 'flat-asset',
      entryBidVwap: 0.5,
      entryPrice: 0.51,
      slBidPoints: 0.1,
      outcome: 'Up',
    };
    const active = resolveActiveChartPosition(ctx, null);
    expect(active?.id).toBe(9);
    expect(active?.entryBidVwap).toBe(0.5);
  });
});

describe('listChartPositions / labels', () => {
  it('formats selector labels with id mode outcome offset', () => {
    expect(
      formatChartPositionSelectorLabel({
        id: 42,
        outcome: 'Up',
        mode: 'sim',
        status: 'Ouverte',
        assetId: 'a',
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        slBidPoints: null,
        tpBidPoints: null,
        exitBidVwap: null,
        openedAt: null,
        closedAt: null,
        positionQuantity: 1,
        entryOffsetLabel: 't+30s',
      }),
    ).toBe('#42 · Sim · Up · t+30s · Ouverte');
  });

  it('hasUsableEntryBidVwap rejects zero', () => {
    expect(hasUsableEntryBidVwap(0)).toBe(false);
    expect(hasUsableEntryBidVwap(0.5)).toBe(true);
    expect(hasUsableEntryBidVwap(null)).toBe(false);
  });

  it('listChartPositions synthesizes one from flat ctx', () => {
    const list = listChartPositions({
      conditionId: 'c',
      copiedPositionId: 3,
      assetId: 'a',
      entryBidVwap: 0.4,
      entryPrice: 0.41,
      outcome: 'Down',
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(3);
  });
});

describe('surveillanceToMarketChartContext', () => {
  it('maps snapshot positions and pre-selects clicked id', () => {
    const ctx = surveillanceToMarketChartContext(
      baseSnapshot({
        positions: [
          {
            id: 10,
            outcome: 'Up',
            mode: 'sim',
            status: 'open',
            quantity: 5,
            entryQuantityFilled: null,
            assetId: 'up-token',
            entryPrice: 0.52,
            entryBidVwap: 0.51,
            slBidPoints: 0.1,
            tpBidPoints: 0.12,
            exitBidVwap: null,
            unrealizedPnl: 0,
            realizedPnl: 0,
            openedAt: '2026-01-01T00:00:30.000Z',
            closedAt: null,
            reason: 'ALGO_OPEN',
            closeReason: null,
            executionErrorSim: null,
            executionErrorReal: null,
            skipReason: null,
          },
          {
            id: 11,
            outcome: 'Down',
            mode: 'real',
            status: 'closed',
            quantity: 0,
            entryQuantityFilled: 4,
            assetId: 'down-token',
            entryPrice: 0.48,
            entryBidVwap: 0.47,
            slBidPoints: 0.1,
            tpBidPoints: 0.12,
            exitBidVwap: 0.55,
            unrealizedPnl: 0,
            realizedPnl: 0.2,
            openedAt: '2026-01-01T00:01:00.000Z',
            closedAt: '2026-01-01T00:04:00.000Z',
            reason: 'ALGO_OPEN',
            closeReason: null,
            executionErrorSim: null,
            executionErrorReal: null,
            skipReason: null,
          },
        ],
      }),
      11,
    );

    expect(ctx.chartPositions).toHaveLength(2);
    expect(ctx.copiedPositionId).toBe(11);
    expect(ctx.cryptoSymbol).toBe('BTC');
    expect(ctx.chartPositions![0]!.entryOffsetLabel).toBe('t+30s');
    expect(ctx.chartPositions![1]!.positionQuantity).toBe(4);
  });

  it('defaults selection to first position when none requested', () => {
    const ctx = surveillanceToMarketChartContext(
      baseSnapshot({
        positions: [
          {
            id: 7,
            outcome: 'Up',
            mode: 'sim',
            status: 'open',
            quantity: 1,
            entryQuantityFilled: null,
            assetId: 'a',
            entryPrice: 0.5,
            entryBidVwap: 0.5,
            slBidPoints: null,
            tpBidPoints: null,
            exitBidVwap: null,
            unrealizedPnl: 0,
            realizedPnl: 0,
            openedAt: null,
            closedAt: null,
            reason: 'ALGO_OPEN',
            closeReason: null,
            executionErrorSim: null,
            executionErrorReal: null,
            skipReason: null,
          },
        ],
      }),
    );
    expect(ctx.copiedPositionId).toBe(7);
  });
});
