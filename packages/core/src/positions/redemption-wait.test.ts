import { describe, expect, it } from 'vitest';
import {
  getRedemptionWaitPhase,
  isActionableFailurePosition,
  isAwaitingRedemptionPosition,
  isRedemptionFailureError,
  shouldSuppressSlTp,
} from './redemption-wait.js';

const terminalMarket = {
  resolved: false,
  winningTokenId: null,
  closed: true,
  acceptingOrders: false,
  endDate: new Date('2026-01-01T00:00:00Z'),
};

const resolvedMarket = {
  ...terminalMarket,
  winningTokenId: 'token-yes',
  resolved: true,
};

describe('isRedemptionFailureError', () => {
  it('detects redemption_failed prefix', () => {
    expect(isRedemptionFailureError('redemption_failed: tx reverted')).toBe(true);
    expect(isRedemptionFailureError('clob_order_failed')).toBe(false);
  });
});

describe('isAwaitingRedemptionPosition', () => {
  it('includes pending_resolution', () => {
    expect(
      isAwaitingRedemptionPosition(
        { status: 'pending_resolution' },
        null,
        null,
      ),
    ).toBe(true);
  });

  it('includes open position on terminal market', () => {
    expect(
      isAwaitingRedemptionPosition({ status: 'open' }, terminalMarket, null),
    ).toBe(true);
  });

  it('includes open position when endDate is past', () => {
    expect(
      isAwaitingRedemptionPosition(
        { status: 'open' },
        {
          ...terminalMarket,
          closed: false,
          acceptingOrders: true,
          endDate: new Date('2020-01-01T00:00:00Z'),
        },
        null,
        new Date('2026-01-01T00:00:00Z').getTime(),
      ),
    ).toBe(true);
  });

  it('excludes open position when winning token is known but market is still live', () => {
    expect(
      isAwaitingRedemptionPosition(
        { status: 'open' },
        {
          ...terminalMarket,
          closed: false,
          acceptingOrders: true,
          winningTokenId: 'token-yes',
          endDate: new Date('2026-12-31T00:00:00Z'),
        },
        null,
      ),
    ).toBe(false);
  });

  it('excludes open position on live market before endDate', () => {
    expect(
      isAwaitingRedemptionPosition(
        { status: 'open' },
        {
          ...terminalMarket,
          closed: false,
          acceptingOrders: true,
          endDate: new Date('2099-01-01T00:00:00Z'),
        },
        null,
        new Date('2026-01-01T00:00:00Z').getTime(),
      ),
    ).toBe(false);
  });

  it('excludes open position on live market', () => {
    expect(
      isAwaitingRedemptionPosition(
        { status: 'open' },
        {
          ...terminalMarket,
          closed: false,
          acceptingOrders: true,
          endDate: new Date('2099-01-01T00:00:00Z'),
        },
        null,
        new Date('2026-01-01T00:00:00Z').getTime(),
      ),
    ).toBe(false);
  });

  it('excludes redemption failures', () => {
    expect(
      isAwaitingRedemptionPosition(
        { status: 'pending_resolution' },
        resolvedMarket,
        'redemption_failed: reverted',
      ),
    ).toBe(false);
  });
});

describe('isActionableFailurePosition', () => {
  it('includes failed on live market', () => {
    expect(
      isActionableFailurePosition(
        { status: 'failed' },
        {
          ...terminalMarket,
          closed: false,
          acceptingOrders: true,
          endDate: new Date('2099-01-01T00:00:00Z'),
        },
        'clob_order_failed',
        new Date('2026-01-01T00:00:00Z').getTime(),
      ),
    ).toBe(true);
  });

  it('excludes failed on terminal market awaiting redemption', () => {
    expect(
      isActionableFailurePosition(
        { status: 'failed' },
        terminalMarket,
        'no_liquidity',
      ),
    ).toBe(false);
  });

  it('includes pending_resolution after redemption failure', () => {
    expect(
      isActionableFailurePosition(
        { status: 'pending_resolution' },
        resolvedMarket,
        'redemption_failed: reverted',
      ),
    ).toBe(true);
  });
});

describe('getRedemptionWaitPhase', () => {
  it('returns awaiting_resolution before outcome is known', () => {
    expect(
      getRedemptionWaitPhase({ status: 'open' }, terminalMarket, null),
    ).toBe('awaiting_resolution');
  });

  it('returns awaiting_redemption once pending_resolution', () => {
    expect(
      getRedemptionWaitPhase(
        { status: 'pending_resolution' },
        resolvedMarket,
        null,
      ),
    ).toBe('awaiting_redemption');
  });

  it('returns awaiting_redemption when market is resolved', () => {
    expect(
      getRedemptionWaitPhase(
        { status: 'open' },
        { ...terminalMarket, resolved: true, winningTokenId: null },
        null,
      ),
    ).toBe('awaiting_redemption');
  });

  it('returns awaiting_resolution (not awaiting_redemption) when winningTokenId known but not resolved', () => {
    expect(
      getRedemptionWaitPhase(
        { status: 'open' },
        {
          resolved: false,
          winningTokenId: 'token-yes',
          closed: false,
          acceptingOrders: true,
          endDate: new Date(Date.now() - 1000),
        },
        null,
      ),
    ).toBe('awaiting_resolution');
  });
});

describe('shouldSuppressSlTp', () => {
  it('suppresses on terminal market (past endDate + not accepting orders, P0 fix)', () => {
    expect(
      shouldSuppressSlTp(terminalMarket),
    ).toBe(true);
  });

  it('suppresses on resolved market', () => {
    expect(
      shouldSuppressSlTp({ ...terminalMarket, resolved: true }),
    ).toBe(true);
  });

  it('does NOT suppress on past endDate when CLOB still accepting orders', () => {
    expect(
      shouldSuppressSlTp({
        resolved: false,
        winningTokenId: null,
        closed: false,
        acceptingOrders: true,
        endDate: new Date('2020-01-01T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('suppresses when CLOB is not accepting orders even before endDate', () => {
    expect(
      shouldSuppressSlTp({
        resolved: false,
        winningTokenId: null,
        closed: false,
        acceptingOrders: false,
        endDate: new Date('2099-01-01T00:00:00Z'),
      }),
    ).toBe(true);
  });

  it('does NOT suppress on winningTokenId alone (sub-market outcome known, not resolved)', () => {
    expect(
      shouldSuppressSlTp({
        resolved: false,
        winningTokenId: 'token-yes',
        closed: false,
        acceptingOrders: true,
        endDate: new Date('2099-01-01T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('does NOT suppress on live market before endDate', () => {
    expect(
      shouldSuppressSlTp({
        resolved: false,
        winningTokenId: null,
        closed: false,
        acceptingOrders: true,
        endDate: new Date('2099-01-01T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('does NOT suppress on null market', () => {
    expect(shouldSuppressSlTp(null)).toBe(false);
  });

  it('does NOT suppress on undefined market', () => {
    expect(shouldSuppressSlTp(undefined)).toBe(false);
  });
});
