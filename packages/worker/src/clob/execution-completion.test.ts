import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  completeExecution,
  executionResultToFinalizeInput,
} from './execution-completion.js';

vi.mock('../polymarket/sync-book-subscriptions.js', () => ({
  syncBookSubscriptions: vi.fn(
    () => new Promise(() => {}) /* intentionally hangs */,
  ),
}));

vi.mock('../polymarket/sync-user-subscriptions.js', () => ({
  syncUserSubscriptions: vi.fn(
    () => new Promise(() => {}) /* intentionally hangs */,
  ),
}));

const mockDs = {} as any;
const mockConnectionManager = {} as any;

function mockExecutionService(pos: any) {
  return {
    finalize: vi.fn().mockResolvedValue(pos),
  } as any;
}

describe('completeExecution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns position when syncBookSubscriptions hangs', async () => {
    const pos = { id: 42, mode: 'sim', status: 'open' };
    const result = await completeExecution(
      mockDs,
      mockExecutionService(pos),
      mockConnectionManager,
      executionResultToFinalizeInput({
        orderSignalId: 'sig-1',
        mode: 'sim',
        status: 'filled',
        fillPrice: 0.5,
        fillQuantity: 10,
        fees: 0,
        executedAt: new Date(),
      } as any),
    );
    expect(result).toEqual(pos);
  });
});
