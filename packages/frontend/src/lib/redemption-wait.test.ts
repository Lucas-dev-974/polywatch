import { describe, expect, it } from 'vitest';

import type { Position } from './position';
import {
  redemptionProgressBadge,
  subMarketOutcomeKnownBadge,
} from './redemption-wait';

function basePosition(
  overrides: Partial<Position> = {},
): Pick<Position, 'marketWinningTokenId' | 'marketResolved' | 'status' | 'marketClosed' | 'marketAcceptingOrders' | 'marketEndDate' | 'lastCloseError'> & { status: string } {
  return {
    status: 'open',
    marketWinningTokenId: null,
    marketResolved: false,
    marketClosed: false,
    marketAcceptingOrders: true,
    marketEndDate: '2099-01-01T00:00:00.000Z',
    lastCloseError: null,
    ...overrides,
  } as Position;
}

describe('subMarketOutcomeKnownBadge', () => {
  it('returns warn badge when winningTokenId is set but market is not resolved', () => {
    const badge = subMarketOutcomeKnownBadge({
      marketWinningTokenId: 'token-yes',
      marketResolved: false,
    });
    expect(badge).toEqual({
      label: 'Résultat connu',
      badgeClass: 'warn',
      tooltip: expect.stringContaining('sous-marché'),
    });
  });

  it('returns null when winningTokenId is absent', () => {
    expect(
      subMarketOutcomeKnownBadge({
        marketWinningTokenId: null,
        marketResolved: false,
      }),
    ).toBeNull();
  });

  it('returns null when market is already resolved', () => {
    expect(
      subMarketOutcomeKnownBadge({
        marketWinningTokenId: 'token-yes',
        marketResolved: true,
      }),
    ).toBeNull();
  });
});

describe('redemptionProgressBadge', () => {
  it('returns accent badge when position is pending_resolution', () => {
    const badge = redemptionProgressBadge(
      basePosition({ status: 'pending_resolution', marketResolved: true }) as Position,
    );
    expect(badge).toEqual({
      label: 'Rédemption',
      badgeClass: 'accent',
      tooltip: expect.stringContaining('Rédemption automatique'),
    });
  });

  it('returns accent badge when market is resolved on open position', () => {
    const badge = redemptionProgressBadge(
      basePosition({
        marketResolved: true,
        marketClosed: true,
        marketAcceptingOrders: false,
      }) as Position,
    );
    expect(badge?.badgeClass).toBe('accent');
  });

  it('returns null for live open position with outcome known only', () => {
    expect(
      redemptionProgressBadge(
        basePosition({
          marketWinningTokenId: 'token-yes',
          marketResolved: false,
        }) as Position,
      ),
    ).toBeNull();
  });
});
