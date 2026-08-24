import { describe, expect, it } from 'vitest';
import type { UpDownPricePoint } from './market-chart';
import type { Execution } from './execution';
import { computeExecutionSlippagePercent } from './execution';
import {
  buildBidAskBandGeometry,
  buildBidAskBandPath,
  findIlliquidIndices,
  findPartialLiquidityIndices,
  findPositionOpenIndices,
  findPriceGapIndices,
  findSignalMarkerIndices,
  hasBidAskBandData,
  hasChartMetrics,
  resolveBandBidAsk,
  resolveSignalExecutionStatus,
  PRICE_GAP_MARKER_THRESHOLD,
  SIGNAL_MARKER_MAX_AGE_MS,
  SIGNAL_MATCH_TOLERANCE_MS,
} from './updown-chart-overlays';

function point(
  t: number,
  metrics?: UpDownPricePoint['metrics'],
  prices?: { up?: number | null; down?: number | null },
): UpDownPricePoint {
  return {
    t,
    up: prices?.up ?? 0.5,
    down: prices?.down ?? 0.5,
    metrics,
  };
}

describe('updown-chart-overlays', () => {
  it('buildBidAskBandPath returns empty for fewer than 2 metric points', () => {
    expect(
      buildBidAskBandPath(
        [point(1_000, { upBid: 0.48, upAsk: 0.52 } as never)],
        'up',
        1_000,
        2_000,
        500,
        200,
        16,
        40,
      ),
    ).toBe('');
  });

  it('buildBidAskBandPath closes a polygon when enough data', () => {
    const path = buildBidAskBandPath(
      [
        point(1_000, {
          upBid: 0.48,
          upAsk: 0.52,
        } as never),
        point(2_000, {
          upBid: 0.49,
          upAsk: 0.53,
        } as never),
      ],
      'up',
      1_000,
      2_000,
      500,
      200,
      16,
      40,
    );
    expect(path.endsWith('Z')).toBe(true);
    expect(path.includes('M')).toBe(true);
  });

  it('buildBidAskBandGeometry splits runs across missing book data', () => {
    const geo = buildBidAskBandGeometry(
      [
        point(1_000, { upBid: 0.48, upAsk: 0.52 } as never),
        point(2_000, { upBid: 0.49, upAsk: 0.53 } as never),
        point(3_000, {} as never),
        point(4_000, { upBid: 0.5, upAsk: 0.54 } as never),
        point(5_000, { upBid: 0.51, upAsk: 0.55 } as never),
      ],
      'up',
      1_000,
      5_000,
      500,
      200,
      16,
      40,
    );
    expect(geo.fills).toHaveLength(2);
    expect(geo.bidEdges).toHaveLength(2);
    expect(geo.askEdges).toHaveLength(2);
  });

  it('resolveBandBidAsk falls back to mid + spreadPct', () => {
    const resolved = resolveBandBidAsk(
      point(
        1_000,
        { upSpreadPct: ((0.52 - 0.48) / 0.52) * 100 } as never,
        { up: 0.5 },
      ),
      'up',
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.ask).toBeGreaterThan(resolved!.bid);
    expect(resolved!.bid).toBeCloseTo(0.48, 2);
    expect(resolved!.ask).toBeCloseTo(0.52, 2);
  });

  it('hasBidAskBandData requires at least two resolvable samples', () => {
    expect(
      hasBidAskBandData([point(1_000, { upBid: 0.48, upAsk: 0.52 } as never)]),
    ).toBe(false);
    expect(
      hasBidAskBandData([
        point(1_000, { upBid: 0.48, upAsk: 0.52 } as never),
        point(2_000, { upBid: 0.49, upAsk: 0.53 } as never),
      ]),
    ).toBe(true);
  });

  it('findSignalMarkerIndices respects max age', () => {
    const indices = findSignalMarkerIndices([
      point(1_000, { signalAgeMs: 100 } as never),
      point(2_000, { signalAgeMs: SIGNAL_MARKER_MAX_AGE_MS + 1 } as never),
    ]);
    expect(indices).toEqual([0]);
  });

  it('findPositionOpenIndices detects 0 to >0 transition', () => {
    const indices = findPositionOpenIndices([
      point(1_000, { openPositionsCount: 0 } as never),
      point(2_000, { openPositionsCount: 1 } as never),
      point(3_000, { openPositionsCount: 2 } as never),
    ]);
    expect(indices).toEqual([1]);
  });

  it('findPriceGapIndices uses threshold', () => {
    const indices = findPriceGapIndices([
      point(1_000, { priceGap: PRICE_GAP_MARKER_THRESHOLD + 0.01 } as never),
      point(2_000, { priceGap: 0.01 } as never),
    ]);
    expect(indices).toEqual([0]);
  });

  it('findIlliquidIndices marks ticks with illiquid side', () => {
    const indices = findIlliquidIndices([
      point(1_000, { upLiquidityStatus: 'ok', downLiquidityStatus: 'ok' } as never),
      point(2_000, { upLiquidityStatus: 'illiquid', downLiquidityStatus: 'ok' } as never),
      point(3_000, { upLiquidityStatus: 'partial', downLiquidityStatus: 'illiquid' } as never),
    ]);
    expect(indices).toEqual([1, 2]);
  });

  it('findPartialLiquidityIndices excludes illiquid ticks', () => {
    const indices = findPartialLiquidityIndices([
      point(1_000, { upLiquidityStatus: 'partial', downLiquidityStatus: 'ok' } as never),
      point(2_000, { upLiquidityStatus: 'illiquid', downLiquidityStatus: 'partial' } as never),
    ]);
    expect(indices).toEqual([0]);
  });

  it('hasChartMetrics is false when metrics absent', () => {
    expect(hasChartMetrics([point(1_000), point(2_000)])).toBe(false);
    expect(hasChartMetrics([point(1_000, { upSpreadPct: 1 } as never)])).toBe(
      true,
    );
  });
});

describe('resolveSignalExecutionStatus', () => {
  const CONDITION_ID = '0xabc';
  const NOW = 1_700_000_000_000;
  // Signal emitted 3000ms before the tick timestamp.
  const signalPoint = (ageMs: number, t = NOW): UpDownPricePoint =>
    point(t, {
      signalAgeMs: ageMs,
      lastSignalOutcome: 'YES',
      lastSignalConfidence: 0.8,
      lastSignalStrategyId: 'naive-momentum',
    } as never);

  function execution(overrides: Partial<Execution>): Execution {
    return {
      id: 1,
      orderSignalId: 'sig-1',
      copiedPositionId: 10,
      side: 'BUY',
      reason: 'ALGO_OPEN',
      status: 'filled',
      fillPrice: 0.62,
      fillQuantity: 5,
      referenceVwap: 0.6,
      slippagePercent: 3.33,
      fees: 0,
      mode: 'sim',
      error: null,
      executedAt: new Date(NOW - 3000).toISOString(),
      conditionId: CONDITION_ID,
      ...overrides,
    };
  }

  it('returns executed when a filled ALGO_OPEN execution matches within tolerance', () => {
    const p = signalPoint(3000);
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ status: 'filled', fillPrice: 0.62 })],
      NOW,
    );
    expect(status).toEqual({
      kind: 'executed',
      fillPrice: 0.62,
      slippagePercent: 3.33,
    });
  });

  it('returns failed with slippage for a slippage_exceeded execution', () => {
    const p = signalPoint(3000);
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [
        execution({
          status: 'failed',
          error: 'slippage_exceeded',
          fillPrice: null,
          slippagePercent: 16.67,
          referenceVwap: 0.6,
        }),
      ],
      NOW,
    );
    expect(status.kind).toBe('failed');
    if (status.kind === 'failed') {
      expect(status.error).toBe('slippage_exceeded');
      expect(status.slippagePercent).toBeCloseTo(16.67, 2);
    }
  });

  it('returns pending when signal age is below the grace period and no execution matches', () => {
    const p = signalPoint(500); // < EXECUTION_GRACE_MS (1500)
    const status = resolveSignalExecutionStatus(p, CONDITION_ID, [], NOW);
    expect(status).toEqual({ kind: 'pending' });
  });

  it('returns not_executed when signal age exceeds grace and no execution matches', () => {
    const p = signalPoint(4000); // > EXECUTION_GRACE_MS
    const status = resolveSignalExecutionStatus(p, CONDITION_ID, [], NOW);
    expect(status).toEqual({ kind: 'not_executed' });
  });

  it('ignores executions for a different conditionId', () => {
    const p = signalPoint(3000);
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ conditionId: '0xother' })],
      NOW,
    );
    // age 3000 > grace 1500 → not_executed
    expect(status).toEqual({ kind: 'not_executed' });
  });

  it('ignores executions with a non-ALGO_OPEN reason', () => {
    const p = signalPoint(3000);
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ reason: 'ALGO_INCREASE' })],
      NOW,
    );
    expect(status).toEqual({ kind: 'not_executed' });
  });

  it('ignores executions outside the tolerance window', () => {
    const p = signalPoint(3000);
    // Execution 10s away from signalAtMs (NOW - 3000).
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ executedAt: new Date(NOW - 3000 + 10_000).toISOString() })],
      NOW,
    );
    expect(status).toEqual({ kind: 'not_executed' });
  });

  it('treats partial / live_on_clob as pending', () => {
    const p = signalPoint(3000);
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ status: 'live_on_clob' })],
      NOW,
    );
    expect(status).toEqual({ kind: 'pending' });
  });

  it('returns not_executed when signalAgeMs is null', () => {
    const p = point(NOW, {} as never);
    const status = resolveSignalExecutionStatus(p, CONDITION_ID, [], NOW);
    expect(status).toEqual({ kind: 'not_executed' });
  });

  it('matches execution at the exact tolerance boundary', () => {
    const p = signalPoint(3000);
    const boundary = new Date(NOW - 3000 + SIGNAL_MATCH_TOLERANCE_MS).toISOString();
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ executedAt: boundary })],
      NOW,
    );
    expect(status.kind).toBe('executed');
  });

  it('does not crash when executedAt is null', () => {
    const p = signalPoint(3000);
    const status = resolveSignalExecutionStatus(
      p,
      CONDITION_ID,
      [execution({ executedAt: null })],
      NOW,
    );
    expect(status).toEqual({ kind: 'not_executed' });
  });
});

describe('computeExecutionSlippagePercent', () => {
  function ex(overrides: Partial<Execution>): Execution {
    return {
      id: 1,
      orderSignalId: 's',
      copiedPositionId: 1,
      side: 'BUY',
      reason: 'ALGO_OPEN',
      status: 'filled',
      fillPrice: 0.66,
      fillQuantity: 5,
      referenceVwap: 0.6,
      fees: 0,
      mode: 'sim',
      error: null,
      executedAt: null,
      conditionId: 'c',
      ...overrides,
    };
  }

  it('computes slippage for filled executions', () => {
    expect(computeExecutionSlippagePercent(ex({}))).toBeCloseTo(10, 5);
  });

  it('returns null for failed executions (fillPrice=0 would be misleading)', () => {
    expect(
      computeExecutionSlippagePercent(
        ex({ status: 'failed', fillPrice: 0, error: 'slippage_exceeded' }),
      ),
    ).toBeNull();
  });

  it('returns null when referenceVwap is missing', () => {
    expect(computeExecutionSlippagePercent(ex({ referenceVwap: null }))).toBeNull();
  });

  it('returns null when referenceVwap is zero (division guard)', () => {
    expect(computeExecutionSlippagePercent(ex({ referenceVwap: 0 }))).toBeNull();
  });

  it('returns null when fillPrice is null', () => {
    expect(computeExecutionSlippagePercent(ex({ fillPrice: null }))).toBeNull();
  });
});
