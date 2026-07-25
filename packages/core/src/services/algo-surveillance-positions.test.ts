import { describe, expect, it } from 'vitest';
import {
  RESERVATION_CLOSE_REASON_EXPIRED,
  SURVEILLANCE_SKIP_PENDING_EXECUTION,
} from '../positions/reservation-close-reasons.js';
import { enrichAlgoSurveillancePositions } from './algo-surveillance-positions.js';
import type { AlgoSurveillancePositionSummary } from './algo-surveillance.types.js';

describe('enrichAlgoSurveillancePositions', () => {
  it('returns empty array unchanged', async () => {
    const ds = {} as never;
    await expect(enrichAlgoSurveillancePositions(ds, [])).resolves.toEqual([]);
  });
});

describe('surveillance position failure fields', () => {
  it('documents skip reason constant', () => {
    expect(SURVEILLANCE_SKIP_PENDING_EXECUTION).toBe('pending_execution');
    expect(RESERVATION_CLOSE_REASON_EXPIRED).toBe('reservation_expired');
  });

  it('accepts enriched summary shape', () => {
    const summary: AlgoSurveillancePositionSummary = {
      id: 1,
      outcome: 'NO',
      mode: 'sim',
      status: 'pending',
      quantity: 0,
      entryQuantityFilled: null,
      assetId: 'a1',
      entryPrice: 0,
      entryBidVwap: 0,
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
      skipReason: SURVEILLANCE_SKIP_PENDING_EXECUTION,
    };
    expect(summary.skipReason).toBe('pending_execution');
  });
});
