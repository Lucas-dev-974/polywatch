import type { Redis } from 'ioredis';

export const ALGO_SELECTIONS_CHANGED_CHANNEL = 'algo-selections-changed';

export interface AlgoSelectionsChangedPayload {
  added?: number;
  disabled?: number;
  at?: number;
}

export async function publishAlgoSelectionsChanged(
  redis: Pick<Redis, 'publish'>,
  payload: AlgoSelectionsChangedPayload = {},
): Promise<void> {
  await redis.publish(
    ALGO_SELECTIONS_CHANGED_CHANNEL,
    JSON.stringify({ ...payload, at: payload.at ?? Date.now() }),
  );
}
