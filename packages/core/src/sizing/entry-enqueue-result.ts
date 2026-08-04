import type { RedisQueue } from '../worker-shared/redis-queue.js';
import type { ReservationService } from '../services/reservation.service.js';
import type { OrderSignal } from '../types/index.js';

export interface ResolveEntryEnqueueBlockedParams {
  enqueued: boolean;
  orderQueue: RedisQueue<OrderSignal>;
  dedupeKey: string;
  orderSignalId: string;
  reservationService: ReservationService;
  hasBuyExecution?: () => Promise<boolean>;
  hasInFlightBuy?: () => Promise<boolean>;
  /** Returned when the reservation is released after a hard enqueue block. */
  blockedReason: string;
}

/**
 * Interpret the result of {@link enqueueEntrySignal} after a successful reserve.
 * Returns `null` when the entry path should be treated as success/deferred.
 */
export async function resolveEntryEnqueueBlocked(
  params: ResolveEntryEnqueueBlockedParams,
): Promise<string | null> {
  if (params.enqueued) return null;

  if (params.hasInFlightBuy && (await params.hasInFlightBuy())) {
    return null;
  }

  if (params.hasBuyExecution && (await params.hasBuyExecution())) {
    await params.reservationService
      .release(params.orderSignalId, `enqueue_blocked:${params.blockedReason}`)
      .catch(() => undefined);
    return params.blockedReason;
  }

  if (await params.orderQueue.hasDedupeMarker(params.dedupeKey)) {
    return null;
  }

  await params.reservationService
    .release(params.orderSignalId, `enqueue_blocked:${params.blockedReason}`)
    .catch(() => undefined);
  return params.blockedReason;
}
