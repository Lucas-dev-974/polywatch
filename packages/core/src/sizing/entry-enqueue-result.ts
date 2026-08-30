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
  /** When false, a blocked enqueue leaves the reservation (janitor). Default true. */
  releaseOnBlock?: boolean;
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

  const maybeRelease = async () => {
    if (params.releaseOnBlock === false) return;
    await params.reservationService
      .release(params.orderSignalId, 'enqueue_blocked:' + params.blockedReason)
      .catch(() => undefined);
  };

  if (params.hasBuyExecution && (await params.hasBuyExecution())) {
    await maybeRelease();
    return params.blockedReason;
  }

  if (await params.orderQueue.hasDedupeMarker(params.dedupeKey)) {
    return null;
  }

  await maybeRelease();
  return params.blockedReason;
}