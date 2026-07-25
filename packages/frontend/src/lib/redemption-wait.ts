import {
  getRedemptionWaitPhase as coreGetRedemptionWaitPhase,
  isActionableFailurePosition,
  isAwaitingRedemptionPosition,
  type RedemptionWaitPhase,
} from '@polywatch/core/positions/redemption-wait';

import { POSITION_TOOLTIPS } from './position-tooltips';
import type { Position } from './position';

export type { RedemptionWaitPhase };

export type PositionOutcomeBadge = {
  label: string;
  badgeClass: string;
  tooltip: string;
};

export function positionMarketLifecycle(pos: Position) {
  return {
    resolved: pos.marketResolved,
    winningTokenId: pos.marketWinningTokenId,
    closed: pos.marketClosed,
    acceptingOrders: pos.marketAcceptingOrders,
    endDate: pos.marketEndDate ? new Date(pos.marketEndDate) : null,
  };
}

export function isAwaitingRedemption(pos: Position, now = Date.now()): boolean {
  return isAwaitingRedemptionPosition(
    pos,
    positionMarketLifecycle(pos),
    pos.lastCloseError,
    now,
  );
}

export function isActionableFailure(pos: Position, now = Date.now()): boolean {
  return isActionableFailurePosition(
    pos,
    positionMarketLifecycle(pos),
    pos.lastCloseError,
    now,
  );
}

export function getRedemptionWaitPhase(
  pos: Position,
  now = Date.now(),
): RedemptionWaitPhase | null {
  return coreGetRedemptionWaitPhase(
    pos,
    positionMarketLifecycle(pos),
    pos.lastCloseError,
    now,
  );
}

const REDEMPTION_WAIT_HINTS: Record<RedemptionWaitPhase, string> = {
  awaiting_resolution:
    'Marché fermé — en attente du résultat Polymarket. Clôture automatique ensuite.',
  awaiting_redemption:
    'Rédemption automatique en cours. Aucune action requise.',
};

export function redemptionWaitHint(
  pos: Position,
  now = Date.now(),
): string | null {
  const phase = getRedemptionWaitPhase(pos, now);
  if (!phase) return null;
  return REDEMPTION_WAIT_HINTS[phase];
}

/**
 * Yellow badge — sub-market outcome known (winningTokenId from CLOB price)
 * but Polymarket contract not yet officially resolved.
 */
export function subMarketOutcomeKnownBadge(
  pos: Pick<Position, 'marketWinningTokenId' | 'marketResolved'>,
): PositionOutcomeBadge | null {
  if (!pos.marketWinningTokenId || pos.marketResolved) return null;
  return {
    label: 'Résultat connu',
    badgeClass: 'warn',
    tooltip: POSITION_TOOLTIPS.subMarketOutcomeKnown,
  };
}

/**
 * Blue badge — market resolved or pending_resolution, redemption in progress.
 */
export function redemptionProgressBadge(
  pos: Position,
  now = Date.now(),
): PositionOutcomeBadge | null {
  const phase = getRedemptionWaitPhase(pos, now);
  if (phase !== 'awaiting_redemption') return null;
  return {
    label: 'Rédemption',
    badgeClass: 'accent',
    tooltip: POSITION_TOOLTIPS.redemptionInProgress,
  };
}

export function partitionActivePositions(
  positions: Position[],
  now = Date.now(),
): {
  open: Position[];
  awaitingRedemption: Position[];
  failed: Position[];
} {
  const open: Position[] = [];
  const awaitingRedemption: Position[] = [];
  const failed: Position[] = [];

  for (const pos of positions) {
    if (isAwaitingRedemption(pos, now)) {
      awaitingRedemption.push(pos);
      continue;
    }
    if (isActionableFailure(pos, now)) {
      failed.push(pos);
      continue;
    }
    if (pos.status === 'open' || pos.status === 'closing') {
      open.push(pos);
    }
  }

  return { open, awaitingRedemption, failed };
}

export function canManualClosePosition(pos: Position, now = Date.now()): boolean {
  if (!['open', 'failed', 'closing'].includes(pos.status)) return false;
  return !isAwaitingRedemption(pos, now);
}
