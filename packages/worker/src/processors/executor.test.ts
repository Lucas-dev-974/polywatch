import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Executor } from './executor.js';
import type { OrderSignal } from '@polywatch/core';
import { MetricsReporter } from '../metrics-reporter.js';
import { ensureBookReady } from '../polymarket/ensure-book-ready.js';
import { completeExecution } from '../clob/execution-completion.js';
import { makeGlobalConfig } from './strategy/test-config-fixtures.js';

function mockExecutorConfigServices(executor: Executor): void {
  (executor as any).globalConfigService = {
    getConfig: vi.fn().mockResolvedValue(makeGlobalConfig()),
  };
  (executor as any).copyConfigService = {
    getConfig: vi.fn().mockResolvedValue({
      simCopyTradingEnabled: true,
      realCopyTradingEnabled: true,
    }),
  };
}

// Mock dependencies
vi.mock('../metrics-reporter.js', () => ({
  MetricsReporter: vi.fn().mockImplementation(() => ({
    recordExit: vi.fn(),
    pushStrategyCycle: vi.fn(),
  })),
}));

vi.mock('../clob/real-executor.js', () => ({
  RealExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
  })),
}));

vi.mock('../clob/position-lock-registry.js', () => ({
  PositionLockRegistry: vi.fn().mockImplementation(() => ({
    runSequentially: vi.fn(),
  })),
}));

vi.mock('../polymarket/ensure-book-ready.js', () => ({
  ensureBookReady: vi.fn().mockResolvedValue(true),
}));

vi.mock('../clob/execution-completion.js', () => ({
  completeExecution: vi.fn().mockResolvedValue(undefined),
  executionResultToFinalizeInput: vi.fn((result) => ({
    orderSignalId: result.orderSignalId,
    status: result.status,
    fillPrice: result.fillPrice,
    fillQuantity: result.fillQuantity,
    fees: result.fees,
    entryBidVwap: result.entryBidVwap,
    error: result.error,
    executedAt: result.executedAt,
  })),
}));

function createMockSignal(overrides: Partial<OrderSignal> = {}): OrderSignal {
  return {
    id: 'test-signal-1',
    copiedPositionId: 1,
    mode: 'sim',
    side: 'SELL',
    reason: 'SL',
    quantity: 100,
    assetId: '0xasset',
    conditionId: '0xcondition',
    orderType: 'MARKET',
    closingAttemptSeq: 1,
    closeRetryAttempt: 0,
    referenceVwap: 0.5,
    entryBidVwap: 0.5,
    executableBidVwap: 0.45,
    ...overrides,
  } as OrderSignal;
}

describe('Executor metrics counting', () => {
  let executor: Executor;
  let metricsReporter: MetricsReporter;
  let mockPositionService: { beginClose: ReturnType<typeof vi.fn>; revertClose: ReturnType<typeof vi.fn> };
  let mockExecutionService: { claim: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    metricsReporter = new MetricsReporter();

    mockPositionService = {
      beginClose: vi.fn(),
      revertClose: vi.fn(),
    };

    mockExecutionService = {
      claim: vi.fn().mockRejectedValue(new Error('already_claimed')),
    };

    const mockPositionLocks = {
      runSequentially: vi.fn().mockImplementation(
        (_id: number, fn: (signal: AbortSignal) => Promise<void>) =>
          fn(new AbortController().signal),
      ),
    };

    const mockDs = {
      transaction: vi.fn(),
    };

    executor = new Executor(
      mockDs as any,
      {} as any,
      {} as any,
      mockPositionLocks as any,
      metricsReporter,
    );

    // Override internal services
    (executor as any).positionService = mockPositionService;
    (executor as any).executionService = mockExecutionService;
    mockExecutorConfigServices(executor);
  });

  it('records exit when closingAttemptSeq === 1 and !resumed', async () => {
    mockPositionService.beginClose.mockResolvedValue({
      success: true,
      closingAttemptSeq: 1,
      resumed: false,
    });

    const signal = createMockSignal({ reason: 'SL', closingAttemptSeq: 1 });
    await executor.handle(signal);

    expect(metricsReporter.recordExit).toHaveBeenCalledWith('SL');
  });

  it('does NOT record exit when closingAttemptSeq > 1 (retry)', async () => {
    mockPositionService.beginClose.mockResolvedValue({
      success: true,
      closingAttemptSeq: 2,
      resumed: false,
    });

    const signal = createMockSignal({ reason: 'SL', closingAttemptSeq: 2 });
    await executor.handle(signal);

    expect(metricsReporter.recordExit).not.toHaveBeenCalled();
  });

  it('does NOT record exit when resumed === true (duplicate signal)', async () => {
    mockPositionService.beginClose.mockResolvedValue({
      success: true,
      closingAttemptSeq: 1,
      resumed: true,
    });

    const signal = createMockSignal({ reason: 'TP', closingAttemptSeq: 1 });
    await executor.handle(signal);

    expect(metricsReporter.recordExit).not.toHaveBeenCalled();
  });

  it('does NOT record exit when beginClose fails (concurrent)', async () => {
    mockPositionService.beginClose.mockResolvedValue({
      success: false,
      closingAttemptSeq: 0,
      resumed: false,
    });

    const signal = createMockSignal({ reason: 'SL', closingAttemptSeq: 1 });
    await executor.handle(signal);

    expect(metricsReporter.recordExit).not.toHaveBeenCalled();
  });

  it('records exit for KILL_SWITCH reason', async () => {
    mockPositionService.beginClose.mockResolvedValue({
      success: true,
      closingAttemptSeq: 1,
      resumed: false,
    });

    const signal = createMockSignal({ reason: 'KILL_SWITCH', closingAttemptSeq: 1 });
    await executor.handle(signal);

    expect(metricsReporter.recordExit).toHaveBeenCalledWith('KILL_SWITCH');
  });

  it('does NOT record exit for TIME_EXIT reason (not a total close)', async () => {
    const signal = createMockSignal({ reason: 'TIME_EXIT', closingAttemptSeq: 1 });
    await executor.handle(signal);

    expect(mockPositionService.beginClose).not.toHaveBeenCalled();
    expect(metricsReporter.recordExit).not.toHaveBeenCalled();
  });

  it('records exit even when mos check follows (guard before mos)', async () => {
    mockPositionService.beginClose.mockResolvedValue({
      success: true,
      closingAttemptSeq: 1,
      resumed: false,
    });
    mockPositionService.revertClose.mockResolvedValue(undefined);

    const signal = createMockSignal({ reason: 'SL', closingAttemptSeq: 1, quantity: 1 });
    await executor.handle(signal);

    expect(metricsReporter.recordExit).toHaveBeenCalledWith('SL');
  });
});

describe('Executor entry reservation guard', () => {
  let executor: Executor;
  let mockReservationService: {
    findByOrderSignalId: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  let mockResultsQueue: { enqueue: ReturnType<typeof vi.fn> };
  let mockExecutionService: { claim: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockReservationService = {
      findByOrderSignalId: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
      releaseByCopiedPositionId: vi.fn().mockResolvedValue(undefined),
    };
    mockResultsQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    mockExecutionService = {
      claim: vi.fn(),
    };

    const mockPositionLocks = {
      runSequentially: vi.fn().mockImplementation(
        (_id: number, fn: (signal: AbortSignal) => Promise<void>) =>
          fn(new AbortController().signal),
      ),
    };

    executor = new Executor(
      {} as any,
      {} as any,
      mockResultsQueue as any,
      mockPositionLocks as any,
      new MetricsReporter(),
    );

    (executor as any).reservationService = mockReservationService;
    (executor as any).executionService = mockExecutionService;
    mockExecutorConfigServices(executor);
  });

  it('rejects expired ALGO_OPEN BUY without claiming execution', async () => {
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 1,
      copiedPositionId: 42,
      reservedNotionalUsdc: 5,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'ALGO_OPEN',
      id: 'expired-algo-signal',
      copiedPositionId: 42,
    });

    await executor.handle(signal);

    expect(mockExecutionService.claim).not.toHaveBeenCalled();
    expect(mockReservationService.release).toHaveBeenCalledWith(
      'expired-algo-signal',
      'reservation_expired_before_claim',
    );
    expect(mockResultsQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'reservation_expired',
        orderSignalId: 'expired-algo-signal',
      }),
    );
  });

  it('continues when entry reservation is still active', async () => {
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 2,
      copiedPositionId: 43,
      reservedNotionalUsdc: 10,
      expiresAt: new Date(Date.now() + 120_000),
    });
    mockExecutionService.claim.mockResolvedValue({
      alreadyInFlight: true,
      execution: { mode: 'sim' },
    });

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'ALGO_OPEN',
      id: 'active-algo-signal',
      copiedPositionId: 43,
    });

    await executor.handle(signal);

    expect(mockExecutionService.claim).toHaveBeenCalled();
    expect(mockReservationService.release).not.toHaveBeenCalled();
    expect(mockResultsQueue.enqueue).not.toHaveBeenCalled();
  });

  it('fails cleanly on already_claimed entry BUY collisions', async () => {
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 3,
      copiedPositionId: 44,
      reservedNotionalUsdc: 10,
      expiresAt: new Date(Date.now() + 120_000),
      orderSignalId: 'collision-signal',
    });
    mockExecutionService.claim.mockRejectedValue(new Error('already_claimed'));

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'ALGO_OPEN',
      id: 'collision-signal',
      copiedPositionId: 44,
    });

    await executor.handle(signal);

    expect(mockReservationService.releaseByCopiedPositionId).toHaveBeenCalledWith(44);
    expect(mockResultsQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'signal_id_collision',
        orderSignalId: 'collision-signal',
      }),
    );
  });
});

describe('Executor abort after claim', () => {
  let executor: Executor;
  let mockReservationService: {
    findByOrderSignalId: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  let mockResultsQueue: { enqueue: ReturnType<typeof vi.fn> };
  let mockExecutionService: { claim: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureBookReady).mockResolvedValue(true);

    mockReservationService = {
      findByOrderSignalId: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
      releaseByCopiedPositionId: vi.fn().mockResolvedValue(undefined),
    };
    mockResultsQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    mockExecutionService = {
      claim: vi.fn(),
    };

    executor = new Executor(
      {} as any,
      {} as any,
      mockResultsQueue as any,
      {
        runSequentially: vi.fn().mockImplementation(
          (_id: number, fn: (signal: AbortSignal) => Promise<void>) =>
            fn(new AbortController().signal),
        ),
      } as any,
      new MetricsReporter(),
    );

    (executor as any).reservationService = mockReservationService;
    (executor as any).executionService = mockExecutionService;
    mockExecutorConfigServices(executor);
  });

  it('enqueues position_lock_timeout when aborted after claim', async () => {
    const abortController = new AbortController();
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 1,
      copiedPositionId: 50,
      reservedNotionalUsdc: 10,
      expiresAt: new Date(Date.now() + 120_000),
    });
    mockExecutionService.claim.mockImplementation(async () => {
      abortController.abort();
      return { alreadyInFlight: false, execution: { mode: 'sim' } };
    });

    (executor as any).positionLocks = {
      runSequentially: vi.fn().mockImplementation(
        (_id: number, fn: (signal: AbortSignal) => Promise<void>) =>
          fn(abortController.signal),
      ),
    };

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'COPY_OPEN',
      id: 'abort-after-claim',
      copiedPositionId: 50,
    });

    await executor.handle(signal);

    expect(mockResultsQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'position_lock_timeout',
        orderSignalId: 'abort-after-claim',
      }),
    );
  });

  it('enqueues position_lock_timeout when aborted after ensureBookReady on ALGO_OPEN', async () => {
    const abortController = new AbortController();
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 2,
      copiedPositionId: 51,
      reservedNotionalUsdc: 10,
      expiresAt: new Date(Date.now() + 120_000),
    });
    mockExecutionService.claim.mockResolvedValue({
      alreadyInFlight: false,
      execution: { mode: 'sim' },
    });
    vi.mocked(ensureBookReady).mockImplementation(async () => {
      abortController.abort();
      return true;
    });

    (executor as any).positionLocks = {
      runSequentially: vi.fn().mockImplementation(
        (_id: number, fn: (signal: AbortSignal) => Promise<void>) =>
          fn(abortController.signal),
      ),
    };

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'ALGO_OPEN',
      id: 'abort-after-book',
      copiedPositionId: 51,
    });

    await executor.handle(signal);

    expect(mockResultsQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'position_lock_timeout',
        orderSignalId: 'abort-after-book',
      }),
    );
  });

  it('resolveExecution returns failed on abort instead of null', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const signal = createMockSignal({ side: 'BUY', reason: 'COPY_OPEN' });

    const result = await (executor as any).resolveExecution(
      signal,
      abortController.signal,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'position_lock_timeout',
      }),
    );
  });

  it('enqueues position_lock_timeout when ensureBookReady throws after claim', async () => {
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 4,
      copiedPositionId: 52,
      reservedNotionalUsdc: 10,
      expiresAt: new Date(Date.now() + 120_000),
    });
    mockExecutionService.claim.mockResolvedValue({
      alreadyInFlight: false,
      execution: { mode: 'sim' },
    });
    vi.mocked(ensureBookReady).mockRejectedValue(new Error('Position lock timeout'));

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'ALGO_OPEN',
      id: 'book-throw',
      copiedPositionId: 52,
    });

    await executor.handle(signal);

    expect(mockResultsQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'position_lock_timeout',
        orderSignalId: 'book-throw',
      }),
    );
  });

  it('falls back to local finalize when Redis queue fails repeatedly (sim)', async () => {
    const abortController = new AbortController();
    mockReservationService.findByOrderSignalId.mockResolvedValue({
      reservationId: 5,
      copiedPositionId: 53,
      reservedNotionalUsdc: 10,
      expiresAt: new Date(Date.now() + 120_000),
    });
    mockExecutionService.claim.mockResolvedValue({
      alreadyInFlight: false,
      execution: { mode: 'sim' },
    });
    vi.mocked(ensureBookReady).mockResolvedValue(true);
    vi.mocked(completeExecution).mockResolvedValue({ id: 53, status: 'cancelled' } as any);
    mockResultsQueue.enqueue.mockRejectedValue(new Error('Redis unavailable'));

    (executor as any).positionLocks = {
      runSequentially: vi.fn().mockImplementation(
        (_id: number, fn: (signal: AbortSignal) => Promise<void>) =>
          fn(abortController.signal),
      ),
    };

    const signal = createMockSignal({
      side: 'BUY',
      reason: 'ALGO_OPEN',
      id: 'redis-down',
      copiedPositionId: 53,
    });

    await executor.handle(signal);

    expect(mockResultsQueue.enqueue).toHaveBeenCalledTimes(3);
    expect(completeExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('position_lock_timeout'),
        orderSignalId: 'redis-down',
      }),
    );
  });
});
