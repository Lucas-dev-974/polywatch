import type { Redis } from 'ioredis';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { isAlgoPositionReason } from '../risk/crypto-algo-helpers.js';

export const ALGO_REENTRY_FILL_CHANNEL = 'algo-reentry-fill';

export interface AlgoReentryFillPayload {
  conditionId: string;
  outcome: string;
  filledAtMs?: number;
  /** Copied position id — used for idempotent Redis slot consumption. */
  positionId?: number;
  /** Effective throttle window at fill time (ms). */
  windowMs?: number;
}

export async function publishAlgoReentryFill(
  redis: Pick<Redis, 'publish'>,
  payload: AlgoReentryFillPayload,
): Promise<void> {
  if (!payload.conditionId || !payload.outcome) return;
  await redis.publish(ALGO_REENTRY_FILL_CHANNEL, JSON.stringify(payload));
}

/** True when an algo BUY open fill should consume the re-entry throttle slot. */
export function shouldPublishAlgoReentryFill(
  pos: CopiedPosition,
  execution: { side: string; reason?: string | null },
  result: { status: string; fillQuantity: number },
): boolean {
  if (execution.side !== 'BUY') return false;
  if (!isAlgoPositionReason(pos.reason)) return false;
  if (pos.status !== 'open' || pos.quantity <= 0) return false;
  if (result.fillQuantity <= 0) return false;
  if (result.status !== 'filled' && result.status !== 'partial') return false;
  return true;
}
