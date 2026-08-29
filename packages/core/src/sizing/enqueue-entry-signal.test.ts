import { describe, expect, it, vi } from 'vitest';
import { enqueueEntrySignal } from './enqueue-entry-signal.js';
import type { OrderSignal } from '../types/index.js';

const job: OrderSignal = {
  id: 'sig-1',
  copiedPositionId: 1,
  reservationId: 10,
  conditionId: 'cond',
  assetId: 'asset',
  side: 'BUY',
  quantity: 5,
  pusdAmount: 3,
  orderType: 'FAK',
  referenceVwap: 0.6,
  reason: 'ALGO_OPEN',
  mode: 'sim',
};

function mockQueue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    enqueueUnique: vi.fn().mockResolvedValue(false),
    acquireBoundedRetrySlot: vi.fn().mockResolvedValue(true),
    enqueue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('enqueueEntrySignal', () => {
  it('returns true when enqueueUnique succeeds', async () => {
    const orderQueue = mockQueue({
      enqueueUnique: vi.fn().mockResolvedValue(true),
    });
    const result = await enqueueEntrySignal({
      orderQueue: orderQueue as any,
      job,
      dedupeKey: 'logical',
      ttlSeconds: 60,
    });
    expect(result).toBe(true);
    expect(orderQueue.enqueue).not.toHaveBeenCalled();
    expect(orderQueue.acquireBoundedRetrySlot).not.toHaveBeenCalled();
  });

  it('bounded-retries when deduped and position has no BUY execution', async () => {
    const orderQueue = mockQueue();
    const result = await enqueueEntrySignal({
      orderQueue: orderQueue as any,
      job,
      dedupeKey: 'logical',
      ttlSeconds: 60,
      hasBuyExecution: async () => false,
    });
    expect(result).toBe(true);
    expect(orderQueue.acquireBoundedRetrySlot).toHaveBeenCalledWith('logical', 60, {
      cooldownSeconds: 45,
      maxRetries: 2,
    });
    expect(orderQueue.enqueue).toHaveBeenCalledWith(job);
  });

  it('skips retry when a BUY execution already exists', async () => {
    const orderQueue = mockQueue();
    const result = await enqueueEntrySignal({
      orderQueue: orderQueue as any,
      job,
      dedupeKey: 'logical',
      ttlSeconds: 60,
      hasBuyExecution: async () => true,
    });
    expect(result).toBe(false);
    expect(orderQueue.acquireBoundedRetrySlot).not.toHaveBeenCalled();
    expect(orderQueue.enqueue).not.toHaveBeenCalled();
  });

  it('skips retry while a BUY execution is in flight', async () => {
    const orderQueue = mockQueue();
    const result = await enqueueEntrySignal({
      orderQueue: orderQueue as any,
      job,
      dedupeKey: 'logical',
      ttlSeconds: 60,
      hasBuyExecution: async () => false,
      hasInFlightBuy: async () => true,
    });
    expect(result).toBe(false);
    expect(orderQueue.acquireBoundedRetrySlot).not.toHaveBeenCalled();
    expect(orderQueue.enqueue).not.toHaveBeenCalled();
  });

  it('skips when bounded retry slot is unavailable', async () => {
    const orderQueue = mockQueue({
      acquireBoundedRetrySlot: vi.fn().mockResolvedValue(false),
    });
    const result = await enqueueEntrySignal({
      orderQueue: orderQueue as any,
      job,
      dedupeKey: 'logical',
      ttlSeconds: 60,
      hasBuyExecution: async () => false,
    });
    expect(result).toBe(false);
    expect(orderQueue.enqueue).not.toHaveBeenCalled();
  });
});
