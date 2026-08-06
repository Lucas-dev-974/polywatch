import pino from 'pino';
import type { CryptoAlgoPriceFeed } from './price-feed.js';

const log = pino({ name: 'crypto-algo:post-entry-mid' });

/** Offsets (ms) after a confirmed ALGO_OPEN fill for adverse-selection measurement. */
export const POST_ENTRY_MID_OFFSETS_MS = [1_000, 5_000, 30_000] as const;

export interface PostEntryMidSample {
  offsetMs: number;
  upMid: number | null;
  downMid: number | null;
  sampledAtMs: number;
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
  onSample?: (sample: PostEntryMidSample) => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

const activeTimers = new Map<TimerHandle, typeof clearTimeout>();

/**
 * Cancel all pending post-entry mid sample timers (graceful shutdown).
 */
export function clearPostEntryMidTimers(): void {
  for (const [timer, clearFn] of activeTimers) {
    clearFn(timer);
  }
  activeTimers.clear();
}

/**
 * Schedule mid snapshots at +1s / +5s / +30s after a confirmed algo entry fill.
 * Used to measure adverse selection without blocking the fill path.
 */
export function schedulePostEntryMidLog(
  params: SchedulePostEntryMidLogParams,
): TimerHandle[] {
  const offsets = params.offsetsMs ?? POST_ENTRY_MID_OFFSETS_MS;
  const setTimeoutFn = params.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = params.clearTimeoutFn ?? clearTimeout;
  const nowMs = params.nowMs ?? Date.now;
  const filledAtMs = params.filledAtMs ?? nowMs();
  const timers: TimerHandle[] = [];

  for (const offsetMs of offsets) {
    const delayMs = Math.max(0, filledAtMs + offsetMs - nowMs());
    const timer = setTimeoutFn(() => {
      activeTimers.delete(timer);
      try {
        const prices = params.priceFeed.getOutcomePrices(params.conditionId);
        const sample: PostEntryMidSample = {
          offsetMs,
          upMid: prices.upPrice,
          downMid: prices.downPrice,
          sampledAtMs: nowMs(),
        };
        params.onSample?.(sample);
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

  return timers;
}
