import { describe, expect, it } from 'vitest';
import {
  aggregatePositionMetrics,
  buildAlgoPriceTickRecordInput,
  buildPriceGap,
  computeDeltas,
  computeSecondsUntilEnd,
  computeSpreadAbs,
  computeSpreadPercent,
  computeStalenessMs,
  isOpenAlgoPosition,
  nullableAskVwap,
  parseActiveMarketWindow,
} from './algo-price-tick-snapshot.js';
import type { AlgoSurveillancePositionSummary } from '../services/algo-surveillance.types.js';

function makePos(
  overrides: Partial<AlgoSurveillancePositionSummary> &
    Pick<AlgoSurveillancePositionSummary, 'id'>,
): AlgoSurveillancePositionSummary {
  return {
    id: overrides.id,
    outcome: overrides.outcome ?? 'YES',
    mode: overrides.mode ?? 'sim',
    status: overrides.status ?? 'open',
    quantity: overrides.quantity ?? 10,
    entryQuantityFilled: overrides.entryQuantityFilled ?? null,
    assetId: overrides.assetId ?? 'asset-1',
    entryPrice: overrides.entryPrice ?? 0.5,
    entryBidVwap: overrides.entryBidVwap ?? 0.49,
    slBidPoints: overrides.slBidPoints ?? null,
    tpBidPoints: overrides.tpBidPoints ?? null,
    exitBidVwap: overrides.exitBidVwap ?? null,
    unrealizedPnl: overrides.unrealizedPnl ?? 0,
    realizedPnl: overrides.realizedPnl ?? 0,
    openedAt: overrides.openedAt ?? null,
    closedAt: overrides.closedAt ?? null,
    reason: overrides.reason ?? 'ALGO_OPEN',
  };
}

describe('algo-price-tick-snapshot', () => {
  it('buildPriceGap returns abs(up + down - 1)', () => {
    expect(buildPriceGap(0.55, 0.45)).toBe(0);
    expect(buildPriceGap(0.6, 0.5)).toBeCloseTo(0.1);
    expect(buildPriceGap(null, null)).toBeNull();
  });

  it('computeSpreadPercent uses ask as denominator', () => {
    expect(computeSpreadPercent(0.48, 0.52)).toBeCloseTo(7.692, 2);
    expect(computeSpreadPercent(null, 0.52)).toBeNull();
  });

  it('computeSpreadAbs returns ask - bid', () => {
    expect(computeSpreadAbs(0.48, 0.52)).toBeCloseTo(0.04);
    expect(computeSpreadAbs(null, 0.52)).toBeNull();
  });

  it('computeStalenessMs returns max staleness', () => {
    const now = 10_000;
    expect(computeStalenessMs(9_000, 8_500, now)).toBe(1500);
    expect(computeStalenessMs(null, null, now)).toBeNull();
  });

  it('computeDeltas returns null on first tick', () => {
    expect(computeDeltas(null, { up: 0.5, down: 0.5 })).toEqual({
      upDelta1s: null,
      downDelta1s: null,
    });
    expect(computeDeltas({ up: 0.4, down: 0.6 }, { up: 0.45, down: 0.55 })).toEqual({
      upDelta1s: expect.closeTo(0.05),
      downDelta1s: expect.closeTo(-0.05),
    });
  });

  it('aggregatePositionMetrics ignores closed positions', () => {
    const metrics = aggregatePositionMetrics([
      makePos({ id: 1, quantity: 10, entryPrice: 0.4, unrealizedPnl: 2 }),
      makePos({ id: 2, status: 'closed', quantity: 0 }),
    ]);
    expect(metrics).toEqual({ count: 1, exposureUsd: 4, unrealizedPnl: 2 });
  });

  it('isOpenAlgoPosition requires open status and positive quantity', () => {
    expect(isOpenAlgoPosition(makePos({ id: 1 }))).toBe(true);
    expect(isOpenAlgoPosition(makePos({ id: 2, status: 'closed', quantity: 0 }))).toBe(false);
  });

  it('nullableAskVwap returns null when illiquid', () => {
    expect(nullableAskVwap(0, 'illiquid')).toBeNull();
    expect(nullableAskVwap(0.55, 'ok')).toBe(0.55);
  });

  it('computeSecondsUntilEnd floors to zero', () => {
    expect(computeSecondsUntilEnd(15_000, 10_000)).toBe(5);
    expect(computeSecondsUntilEnd(10_000, 12_000)).toBe(0);
  });

  it('buildAlgoPriceTickRecordInput assembles enriched tick payload', () => {
    const input = buildAlgoPriceTickRecordInput({
      conditionId: 'cond-1',
      upPrice: 0.55,
      downPrice: 0.45,
      up: {
        book: { bid: 0.54, ask: 0.56, updatedAt: 9_500 },
        bidSize: 100,
        askSize: 80,
        askVwap: 0.57,
        liquidityStatus: 'ok',
        lastTradePrice: 0.55,
        lastTradeSize: 10,
      },
      down: {
        book: { bid: 0.44, ask: 0.46, updatedAt: 9_800 },
        bidSize: 50,
        askSize: 60,
        askVwap: 0.47,
        liquidityStatus: 'partial',
        lastTradePrice: null,
        lastTradeSize: null,
      },
      marketEndMs: 20_000,
      now: 10_000,
      wsHealthy: true,
      prevMid: { up: 0.5, down: 0.5 },
      positionMetrics: { count: 1, exposureUsd: 5, unrealizedPnl: 0.5 },
      lastSignal: {
        outcome: 'YES',
        confidence: 0.8,
        strategyId: 'naive-momentum',
        atMs: 9_000,
      },
      lastAbstain: { reason: 'spread_gate', atMs: 8_000 },
    });

    expect(input.priceGap).toBe(0);
    expect(input.secondsUntilEnd).toBe(10);
    expect(input.upDelta1s).toBeCloseTo(0.05);
    expect(input.openPositionsCount).toBe(1);
    expect(input.signalAgeMs).toBe(1000);
    expect(input.lastSignalOutcome).toBe('YES');
    expect(input.lastAbstainReason).toBe('spread_gate');
    expect(input.upLiquidityStatus).toBe('ok');
    expect(input.downLiquidityStatus).toBe('partial');
  });

  it('formats abstain detail into lastAbstainReason', () => {
    const input = buildAlgoPriceTickRecordInput({
      conditionId: 'cond-1',
      upPrice: 0.55,
      downPrice: 0.45,
      up: {
        book: { bid: 0.54, ask: 0.56, updatedAt: 9_500 },
        bidSize: 100,
        askSize: 80,
        askVwap: 0.57,
        liquidityStatus: 'ok',
        lastTradePrice: null,
        lastTradeSize: null,
      },
      down: {
        book: { bid: 0.44, ask: 0.46, updatedAt: 9_800 },
        bidSize: 50,
        askSize: 60,
        askVwap: 0.47,
        liquidityStatus: 'ok',
        lastTradePrice: null,
        lastTradeSize: null,
      },
      marketEndMs: 20_000,
      now: 10_000,
      wsHealthy: true,
      prevMid: null,
      positionMetrics: { count: 0, exposureUsd: 0, unrealizedPnl: 0 },
      lastSignal: null,
      lastAbstain: {
        reason: 'spread_gate',
        detail: 'spreadAbs=0.0600',
        atMs: 8_000,
      },
    });
    expect(input.lastAbstainReason).toBe('spread_gate:spreadAbs=0.0600');
  });

  it('parseActiveMarketWindow rejects ended markets', () => {
    expect(
      parseActiveMarketWindow('c1', '2020-01-01T00:00:00.000Z', '2020-01-01T01:00:00.000Z'),
    ).toBeNull();
  });
});
