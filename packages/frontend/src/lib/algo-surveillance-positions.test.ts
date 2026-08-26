import { describe, expect, it } from 'vitest';
import type { AlgoSurveillancePositionSummary } from './algo-surveillance';
import {
  surveillancePositionCloseReasonBadgeClass,
  surveillancePositionCloseReasonLabel,
  surveillancePositionFailureHint,
} from './algo-surveillance-positions';

function basePos(
  overrides: Partial<AlgoSurveillancePositionSummary> = {},
): AlgoSurveillancePositionSummary {
  return {
    id: 1,
    outcome: 'NO',
    mode: 'sim',
    status: 'cancelled',
    quantity: 0,
    entryQuantityFilled: null,
    assetId: 'a1',
    entryPrice: 0,
    entryBidVwap: 0,
    slPercent: null,
    tpPercent: null,
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
    ...overrides,
  };
}

describe('surveillancePositionFailureHint', () => {
  it('maps reservation_expired close reason', () => {
    expect(
      surveillancePositionFailureHint(
        basePos({ closeReason: 'reservation_expired' }),
      ),
    ).toBe('Non exécutée : réservation expirée (ordre non traité à temps)');
  });

  it('maps pending_execution skip reason', () => {
    expect(
      surveillancePositionFailureHint(
        basePos({ status: 'pending', skipReason: 'pending_execution' }),
      ),
    ).toBe('Non exécutée : en attente d\'exécution (file worker)');
  });

  it('prefers execution error over close reason', () => {
    expect(
      surveillancePositionFailureHint(
        basePos({
          closeReason: 'reservation_expired',
          executionErrorSim: 'placing_orphan',
        }),
      ),
    ).toBe('Exécution échouée : exécution interrompue (worker)');
  });

  it('returns null when position filled', () => {
    expect(
      surveillancePositionFailureHint(
        basePos({ status: 'open', quantity: 5, entryPrice: 0.6 }),
      ),
    ).toBeNull();
  });

  it('returns null for normal exit reasons such as TP or SL', () => {
    expect(
      surveillancePositionFailureHint(
        basePos({ status: 'closed', closeReason: 'TP', realizedPnl: 1.29 }),
      ),
    ).toBeNull();
    expect(
      surveillancePositionFailureHint(
        basePos({ status: 'closed', closeReason: 'SL', realizedPnl: -0.5 }),
      ),
    ).toBeNull();
    expect(
      surveillancePositionFailureHint(
        basePos({ status: 'closed', closeReason: 'COPY_CLOSE', realizedPnl: 0.1 }),
      ),
    ).toBeNull();
  });
});

describe('surveillancePositionCloseReasonLabel', () => {
  it('returns TP/SL labels for closed positions', () => {
    expect(
      surveillancePositionCloseReasonLabel(basePos({ status: 'closed', closeReason: 'TP' })),
    ).toBe('TP');
    expect(
      surveillancePositionCloseReasonLabel(basePos({ status: 'closed', closeReason: 'SL' })),
    ).toBe('SL');
  });

  it('returns null when position is not closed', () => {
    expect(
      surveillancePositionCloseReasonLabel(basePos({ status: 'open', closeReason: 'TP' })),
    ).toBeNull();
  });

  it('returns null for entry-cancellation reasons', () => {
    expect(
      surveillancePositionCloseReasonLabel(
        basePos({ status: 'closed', closeReason: 'reservation_expired' }),
      ),
    ).toBeNull();
  });
});

describe('surveillancePositionCloseReasonBadgeClass', () => {
  it('maps TP to success and SL to danger', () => {
    expect(
      surveillancePositionCloseReasonBadgeClass(basePos({ status: 'closed', closeReason: 'TP' })),
    ).toBe('success');
    expect(
      surveillancePositionCloseReasonBadgeClass(basePos({ status: 'closed', closeReason: 'SL' })),
    ).toBe('danger');
  });

  it('returns null for non-closed or entry-cancellation positions', () => {
    expect(
      surveillancePositionCloseReasonBadgeClass(basePos({ status: 'open', closeReason: 'TP' })),
    ).toBeNull();
    expect(
      surveillancePositionCloseReasonBadgeClass(
        basePos({ status: 'closed', closeReason: 'reservation_expired' }),
      ),
    ).toBeNull();
  });
});
