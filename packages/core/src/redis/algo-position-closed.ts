import type { Redis } from 'ioredis';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { isAlgoPositionReason } from '../risk/crypto-algo-helpers.js';

export const ALGO_POSITION_CLOSED_CHANNEL = 'algo-position-closed';

export interface AlgoPositionClosedPayload {
  positionId: number;
  conditionId?: string;
}

export async function publishAlgoPositionClosed(
  redis: Pick<Redis, 'publish'>,
  payload: AlgoPositionClosedPayload,
): Promise<void> {
  if (!Number.isFinite(payload.positionId)) return;
  await redis.publish(ALGO_POSITION_CLOSED_CHANNEL, JSON.stringify(payload));
}

/** True when a fully closed algo position should cancel post-entry mid timers. */
export function shouldPublishAlgoPositionClosed(pos: CopiedPosition): boolean {
  if (pos.status !== 'closed') return false;
  return isAlgoPositionReason(pos.reason);
}
