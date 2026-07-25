import type { Redis } from 'ioredis';
import type { TradingMode } from '../types/index.js';

/** Default pause after a failed ALGO_OPEN BUY before crypto-algo may reserve again. */
export const ALGO_ENTRY_COOLDOWN_SECONDS = 30;

export function algoEntryCooldownKey(conditionId: string, mode: TradingMode): string {
  return `algo-entry-cooldown:${conditionId}:${mode}`;
}

export async function setAlgoEntryCooldown(
  redis: Pick<Redis, 'set'>,
  conditionId: string,
  mode: TradingMode,
  ttlSeconds = ALGO_ENTRY_COOLDOWN_SECONDS,
): Promise<void> {
  if (!conditionId) return;
  await redis.set(
    algoEntryCooldownKey(conditionId, mode),
    '1',
    'EX',
    Math.max(1, ttlSeconds),
  );
}

export async function hasAlgoEntryCooldown(
  redis: Pick<Redis, 'exists'>,
  conditionId: string,
  mode: TradingMode,
): Promise<boolean> {
  if (!conditionId) return false;
  return (await redis.exists(algoEntryCooldownKey(conditionId, mode))) === 1;
}
