import { describe, expect, it, vi } from 'vitest';
import { resolveEntryEnqueueBlocked } from './entry-enqueue-result.js';
import type { RedisQueue } from '../worker-shared/redis-queue.js';
import type { ReservationService } from '../services/reservation.service.js';

function makeQueue(hasDedupeMarker: boolean): RedisQueue<unknown> {
  return {
    hasDedupeMarker: vi.fn(async () => hasDedupeMarker),
  } as unknown as RedisQueue<unknown>;
}

function makeReservationService(): ReservationService {
  return {
    release: vi.fn(async () => undefined),
  } as unknown as ReservationService;
}

describe('resolveEntryEnqueueBlocked', () => {
  it('returns null when enqueue succeeded', async () => {
    const result = await resolveEntryEnqueueBlocked({
      enqueued: true,
      orderQueue: makeQueue(false),
      dedupeKey: 'key',
      orderSignalId: 'sig-1',
      reservationService: makeReservationService(),
      blockedReason: 'blocked',
    });
    expect(result).toBeNull();
  });

  it('defers when BUY is in flight', async () => {
    const reservationService = makeReservationService();
    const result = await resolveEntryEnqueueBlocked({
      enqueued: false,
      orderQueue: makeQueue(false),
      dedupeKey: 'key',
      orderSignalId: 'sig-1',
      reservationService,
      hasInFlightBuy: async () => true,
      blockedReason: 'blocked',
    });
    expect(result).toBeNull();
    expect(reservationService.release).not.toHaveBeenCalled();
  });

  it('releases when BUY execution already exists', async () => {
    const reservationService = makeReservationService();
    const result = await resolveEntryEnqueueBlocked({
      enqueued: false,
      orderQueue: makeQueue(true),
      dedupeKey: 'key',
      orderSignalId: 'sig-1',
      reservationService,
      hasBuyExecution: async () => true,
      blockedReason: 'blocked',
    });
    expect(result).toBe('blocked');
    expect(reservationService.release).toHaveBeenCalledWith('sig-1', 'enqueue_blocked:blocked');
  });

  it('defers when dedupe marker is still active', async () => {
    const reservationService = makeReservationService();
    const result = await resolveEntryEnqueueBlocked({
      enqueued: false,
      orderQueue: makeQueue(true),
      dedupeKey: 'key',
      orderSignalId: 'sig-1',
      reservationService,
      hasBuyExecution: async () => false,
      blockedReason: 'blocked',
    });
    expect(result).toBeNull();
    expect(reservationService.release).not.toHaveBeenCalled();
  });

  it('releases when enqueue is hard-blocked', async () => {
    const reservationService = makeReservationService();
    const result = await resolveEntryEnqueueBlocked({
      enqueued: false,
      orderQueue: makeQueue(false),
      dedupeKey: 'key',
      orderSignalId: 'sig-1',
      reservationService,
      blockedReason: 'blocked',
    });
    expect(result).toBe('blocked');
    expect(reservationService.release).toHaveBeenCalledWith('sig-1', 'enqueue_blocked:blocked');
  });
});
