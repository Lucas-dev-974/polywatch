import type { Redis } from 'ioredis';

/**
 * Persistent crypto-algo re-entry throttle (survives process restart).
 *
 * Keyed by conditionId:outcome — same composite as the in-memory Map used
 * historically (mode is intentionally omitted to preserve that semantics).
 * Count + windowStart are stored so maxEntries > 1 keeps working.
 * positionIds make fill recording idempotent across partial → filled.
 */

export interface CryptoReentryRedisState {
  windowStart: number;
  windowMs: number;
  count: number;
  positionIds: number[];
}

/** Normalize YES/NO / Up/Down labels for throttle keys. */
export function normalizeCryptoReentryOutcome(
  outcome: string,
): 'YES' | 'NO' | null {
  const v = outcome.trim().toLowerCase();
  if (v === 'yes' || v === 'up') return 'YES';
  if (v === 'no' || v === 'down') return 'NO';
  return null;
}

export function cryptoReentryThrottleKey(
  conditionId: string,
  outcome: string,
): string {
  const normalized = normalizeCryptoReentryOutcome(outcome) ?? outcome;
  return `crypto-reentry:${conditionId}:${normalized}`;
}

export function parseCryptoReentryRedisState(
  raw: string | null | undefined,
): CryptoReentryRedisState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CryptoReentryRedisState>;
    if (
      typeof parsed.windowStart !== 'number' ||
      typeof parsed.windowMs !== 'number' ||
      typeof parsed.count !== 'number' ||
      !Number.isFinite(parsed.windowStart) ||
      !Number.isFinite(parsed.windowMs) ||
      !Number.isFinite(parsed.count)
    ) {
      return null;
    }
    const positionIds = Array.isArray(parsed.positionIds)
      ? parsed.positionIds.filter((id): id is number => typeof id === 'number')
      : [];
    return {
      windowStart: parsed.windowStart,
      windowMs: parsed.windowMs,
      count: parsed.count,
      positionIds,
    };
  } catch {
    return null;
  }
}

export async function loadCryptoReentryState(
  redis: Pick<Redis, 'get'>,
  conditionId: string,
  outcome: string,
): Promise<CryptoReentryRedisState | null> {
  if (!conditionId || !normalizeCryptoReentryOutcome(outcome)) return null;
  const raw = await redis.get(cryptoReentryThrottleKey(conditionId, outcome));
  return parseCryptoReentryRedisState(raw);
}

export type CryptoReentryLoadResult =
  | { ok: true; state: CryptoReentryRedisState | null }
  | { ok: false; error: unknown };

/** Fail-distinguishable load for fail-closed suppress checks. */
export async function tryLoadCryptoReentryState(
  redis: Pick<Redis, 'get'>,
  conditionId: string,
  outcome: string,
): Promise<CryptoReentryLoadResult> {
  try {
    return {
      ok: true,
      state: await loadCryptoReentryState(redis, conditionId, outcome),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

export function isCryptoReentrySuppressed(
  state: CryptoReentryRedisState | null | undefined,
  nowMs: number,
  maxEntries: number,
): boolean {
  if (!state) return false;
  if (nowMs - state.windowStart >= state.windowMs) return false;
  return state.count >= maxEntries;
}

export interface RecordCryptoReentryFillInput {
  conditionId: string;
  outcome: string;
  positionId: number;
  windowMs: number;
  nowMs?: number;
}

export interface RecordCryptoReentryFillResult {
  recorded: boolean;
  state: CryptoReentryRedisState;
}

/**
 * Idempotently consume one re-entry slot for a confirmed BUY fill.
 * Returns recorded=false when the same positionId already counted.
 */
export async function recordCryptoReentryFill(
  redis: Pick<Redis, 'get' | 'set'>,
  input: RecordCryptoReentryFillInput,
): Promise<RecordCryptoReentryFillResult> {
  const { conditionId, positionId, windowMs } = input;
  const nowMs = input.nowMs ?? Date.now();
  const outcome = normalizeCryptoReentryOutcome(input.outcome);
  if (!conditionId || !outcome || !(positionId > 0) || !(windowMs > 0)) {
    return {
      recorded: false,
      state: { windowStart: nowMs, windowMs, count: 0, positionIds: [] },
    };
  }

  const key = cryptoReentryThrottleKey(conditionId, outcome);
  const existing = parseCryptoReentryRedisState(await redis.get(key));
  const inWindow =
    existing != null && nowMs - existing.windowStart < existing.windowMs;

  if (inWindow && existing.positionIds.includes(positionId)) {
    return { recorded: false, state: existing };
  }

  let next: CryptoReentryRedisState;
  if (inWindow && existing) {
    next = {
      windowStart: existing.windowStart,
      windowMs: existing.windowMs,
      count: existing.count + 1,
      positionIds: [...existing.positionIds, positionId],
    };
  } else {
    next = {
      windowStart: nowMs,
      windowMs,
      count: 1,
      positionIds: [positionId],
    };
  }

  const remainingMs = Math.max(1, next.windowStart + next.windowMs - nowMs);
  const ttlSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  await redis.set(key, JSON.stringify(next), 'EX', ttlSeconds);
  return { recorded: true, state: next };
}
