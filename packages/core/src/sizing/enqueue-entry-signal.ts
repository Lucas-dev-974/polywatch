import type { RedisQueue } from '../worker-shared/redis-queue.js';
import type { OrderSignal } from '../types/index.js';
import {
  ENTRY_ENQUEUE_MAX_RETRIES_PER_RESERVATION,
  ENTRY_ENQUEUE_RETRY_COOLDOWN_SECONDS,
} from './entry-enqueue-retry.js';

export interface EnqueueEntrySignalParams {
  orderQueue: RedisQueue<OrderSignal>;
  job: OrderSignal;
  /** Redis dedupe marker key (market-level for algo, signal id for copy). */
  dedupeKey: string;
  ttlSeconds: number;
  /** When deduped, re-enqueue only if the position still has no BUY execution row. */
  hasBuyExecution?: () => Promise<boolean>;
  /** Skip bounded retry while a BUY execution is in flight (placing / live / partial). */
  hasInFlightBuy?: () => Promise<boolean>;
}

/**
 * Enqueue a BUY entry signal with deduplication. When the dedupe marker is still
 * set, allow at most one bounded force re-enqueue (cooldown + max retries per
 * reservation window) so tick spam cannot flood the queue while worker is down.
 */
export async function enqueueEntrySignal(
  params: EnqueueEntrySignalParams,
): Promise<boolean> {
  const {
    orderQueue,
    job,
    dedupeKey,
    ttlSeconds,
    hasBuyExecution,
    hasInFlightBuy,
  } = params;
  const enqueued = await orderQueue.enqueueUnique(job, dedupeKey, ttlSeconds);
  if (enqueued) return true;

  if (hasInFlightBuy && (await hasInFlightBuy())) {
    return false;
  }
  if (hasBuyExecution && (await hasBuyExecution())) {
    return false;
  }

  const retrySlot = await orderQueue.acquireBoundedRetrySlot(dedupeKey, ttlSeconds, {
    cooldownSeconds: ENTRY_ENQUEUE_RETRY_COOLDOWN_SECONDS,
    maxRetries: ENTRY_ENQUEUE_MAX_RETRIES_PER_RESERVATION,
  });
  if (!retrySlot) return false;

  await orderQueue.enqueue(job);
  return true;
}
