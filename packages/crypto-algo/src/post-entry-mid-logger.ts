import pino from 'pino';
import type { CryptoAlgoPriceFeed } from './price-feed.js';

const log = pino({ name: 'crypto-algo:post-entry-mid' });

/** Offsets (ms) after a confirmed ALGO_OPEN fill for adverse-selection measurement. */
export const POST_ENTRY_MID_OFFSETS_MS = [1_000, 5_000, 30_000] as const;

/** Default retention for persisted samples (14 days). */
export const POST_ENTRY_MID_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface PostEntryMidSamplePoint {
  offsetMs: number;
  upMid: number | null;
  downMid: number | null;
  sampledAtMs: number;
}

export interface PostEntryMidHandle {
  timers: TimerHandle[];
  cancel: () => void;
}

export interface SchedulePostEntryMidLogParams {
  conditionId: string;
  outcome: string;
  positionId?: number;
  filledAtMs?: number;
  priceFeed: Pick<CryptoAlgoPriceFeed, 'getOutcomePrices'>;
  offsetsMs?: readonly number[];
  /** Injectable for tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  nowMs?: () => number;
  onSample?: (sample: PostEntryMidSamplePoint) => void | Promise<void>;
}

type TimerHandle = ReturnType<typeof setTimeout>;

const activeTimers = new Map<TimerHandle, typeof clearTimeout>();
const handlesByPositionId = new Map<number, PostEntryMidHandle>();

/**
 * Cancel all pending post-entry mid sample timers (graceful shutdown).
 */
export function clearPostEntryMidTimers(): void {
  for (const [timer, clearFn] of activeTimers) {
    clearFn(timer);
  }
  activeTimers.clear();
  handlesByPositionId.clear();
}

/** Cancel timers scheduled for a specific position (early close). */
export function cancelPostEntryMidTimersForPosition(positionId: number): boolean {
  const handle = handlesByPositionId.get(positionId);
  if (!handle) return false;
  handle.cancel();
  return true;
}

export function getActivePostEntryMidTimerCount(): number {
  return activeTimers.size;
}

/**
 * Schedule mid snapshots at +1s / +5s / +30s after a confirmed algo entry fill.
 * Used to measure adverse selection without blocking the fill path.
 */
export function schedulePostEntryMidLog(
  params: SchedulePostEntryMidLogParams,
): PostEntryMidHandle {
  const offsets = params.offsetsMs ?? POST_ENTRY_MID_OFFSETS_MS;
  const setTimeoutFn = params.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = params.clearTimeoutFn ?? clearTimeout;
  const nowMs = params.nowMs ?? Date.now;
  const filledAtMs = params.filledAtMs ?? nowMs();
  const timers: TimerHandle[] = [];

  const cancel = (): void => {
    for (const timer of timers) {
      const clearFn = activeTimers.get(timer);
      if (!clearFn) continue;
      clearFn(timer);
      activeTimers.delete(timer);
    }
    timers.length = 0;
    if (params.positionId != null) {
      handlesByPositionId.delete(params.positionId);
    }
  };

  for (const offsetMs of offsets) {
    const delayMs = Math.max(0, filledAtMs + offsetMs - nowMs());
    const timer = setTimeoutFn(() => {
      activeTimers.delete(timer);
      const idx = timers.indexOf(timer);
      if (idx >= 0) timers.splice(idx, 1);
      if (timers.length === 0 && params.positionId != null) {
        handlesByPositionId.delete(params.positionId);
      }
      try {
        const prices = params.priceFeed.getOutcomePrices(params.conditionId);
        const sample: PostEntryMidSamplePoint = {
          offsetMs,
          upMid: prices.upPrice,
          downMid: prices.downPrice,
          sampledAtMs: nowMs(),
        };
        void Promise.resolve(params.onSample?.(sample)).catch((err) => {
          log.warn(
            {
              err,
              conditionId: params.conditionId,
              outcome: params.outcome,
              offsetMs,
            },
            'post-entry mid onSample failed',
          );
        });
        log.info(
          {
            conditionId: params.conditionId,
            outcome: params.outcome,
            positionId: params.positionId ?? null,
            filledAtMs,
            offsetMs: sample.offsetMs,
            upMid: sample.upMid,
            downMid: sample.downMid,
            sampledAtMs: sample.sampledAtMs,
          },
          'post-entry mid sample',
        );
      } catch (err) {
        log.warn(
          {
            err,
            conditionId: params.conditionId,
            outcome: params.outcome,
            offsetMs,
          },
          'failed to sample post-entry mid',
        );
      }
    }, delayMs);
    activeTimers.set(timer, clearTimeoutFn);
    timers.push(timer);
  }

  const handle: PostEntryMidHandle = { timers, cancel };
  if (params.positionId != null) {
    // Replace any previous schedule for the same position.
    cancelPostEntryMidTimersForPosition(params.positionId);
    handlesByPositionId.set(params.positionId, handle);
  }
  return handle;
}
