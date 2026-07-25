import type { Redis } from 'ioredis';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import { isAlgoPositionReason } from '../risk/crypto-algo-helpers.js';
import type { TradingMode } from '../types/index.js';

export const ALGO_SL_QUOTA_INVALIDATE_CHANNEL = 'algo-sl-quota-invalidate';

export async function publishAlgoSlQuotaInvalidate(
  redis: Pick<Redis, 'publish'>,
  conditionId: string,
  mode?: TradingMode,
): Promise<void> {
  if (!conditionId) return;
  await redis.publish(
    ALGO_SL_QUOTA_INVALIDATE_CHANNEL,
    JSON.stringify({ conditionId, mode }),
  );
}

/** True when an algo position SL close should refresh crypto-algo SL quota cache. */
export function shouldInvalidateAlgoSlQuotaOnClose(
  pos: CopiedPosition,
  exitReason?: string | null,
): boolean {
  if (!isAlgoPositionReason(pos.reason)) return false;
  return pos.closeReason === 'SL' || exitReason === 'SL';
}
