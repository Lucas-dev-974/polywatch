import { describe, expect, it } from 'vitest';
import {
  getRedemptionPayoff,
  isMarketOutcomeKnown,
  isMarketRedeemable,
  isMarketSettled,
  isMarketTerminal,
  shouldPollMarketForLifecycle,
} from './lifecycle.js';

describe('isMarketSettled', () => {
  it('is true when resolved with a winner', () => {
    expect(
      isMarketSettled({
        resolved: true,
        winningTokenId: '111',
        closed: true,
        acceptingOrders: false,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(true);
  });

  it('is true when closed and not accepting orders with a winner', () => {
    expect(
      isMarketSettled({
        resolved: false,
        winningTokenId: '222',
        closed: true,
        acceptingOrders: false,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(true);
  });

  it('is true when closed and not accepting orders even without winningTokenId (MF-1)', () => {
    expect(
      isMarketSettled({
        resolved: false,
        winningTokenId: null,
        closed: true,
        acceptingOrders: false,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(true);
  });

  it('is false while outcome is unknown and accepting orders', () => {
    expect(
      isMarketSettled({
        resolved: false,
        winningTokenId: null,
        closed: false,
        acceptingOrders: true,
        endDate: new Date('2099-01-01'),
      }),
    ).toBe(false);
  });
});

describe('isMarketOutcomeKnown', () => {
  it('is true when resolved', () => {
    expect(
      isMarketOutcomeKnown({
        resolved: true,
        winningTokenId: null,
        closed: true,
        acceptingOrders: false,
        endDate: null,
      }),
    ).toBe(true);
  });

  it('is true when winningTokenId is set', () => {
    expect(
      isMarketOutcomeKnown({
        resolved: false,
        winningTokenId: 'token-yes',
        closed: true,
        acceptingOrders: false,
        endDate: null,
      }),
    ).toBe(true);
  });

  it('is false on terminal market without known outcome', () => {
    expect(
      isMarketOutcomeKnown({
        resolved: false,
        winningTokenId: null,
        closed: true,
        acceptingOrders: false,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(false);
  });
});

describe('isMarketTerminal', () => {
  it('is true when closed and not accepting orders', () => {
    expect(
      isMarketTerminal({
        resolved: false,
        winningTokenId: null,
        closed: true,
        acceptingOrders: false,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(true);
  });

  it('is false when still accepting orders even if closed', () => {
    expect(
      isMarketTerminal({
        resolved: false,
        winningTokenId: null,
        closed: true,
        acceptingOrders: true,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(false);
  });

  it('is false when not closed', () => {
    expect(
      isMarketTerminal({
        resolved: false,
        winningTokenId: null,
        closed: false,
        acceptingOrders: true,
        endDate: new Date('2099-01-01'),
      }),
    ).toBe(false);
  });
});

describe('isMarketRedeemable', () => {
  it('is true when settled with a known winner', () => {
    const state = {
      resolved: true,
      winningTokenId: '1',
      closed: true,
      acceptingOrders: false,
      endDate: null,
    };
    expect(isMarketRedeemable(state)).toBe(true);
  });

  it('is false when settled but no winning token (MF-1 — not redeemable)', () => {
    const state = {
      resolved: false,
      winningTokenId: null,
      closed: true,
      acceptingOrders: false,
      endDate: null,
    };
    expect(isMarketRedeemable(state)).toBe(false);
  });
});

describe('getRedemptionPayoff', () => {
  it('returns 1 for winning token', () => {
    expect(getRedemptionPayoff('111', '111')).toBe(1);
  });

  it('returns 0 for losing token', () => {
    expect(getRedemptionPayoff('111', '222')).toBe(0);
  });
});

describe('shouldPollMarketForLifecycle', () => {
  it('polls during pre-close window before endDate', () => {
    expect(
      shouldPollMarketForLifecycle(
        {
          resolved: false,
          endDate: new Date(Date.now() + 30_000),
        },
        60,
      ),
    ).toBe(true);
  });

  it('skips polling before pre-close window', () => {
    expect(
      shouldPollMarketForLifecycle(
        {
          resolved: false,
          endDate: new Date(Date.now() + 86_400_000),
        },
        60,
      ),
    ).toBe(false);
  });
});
