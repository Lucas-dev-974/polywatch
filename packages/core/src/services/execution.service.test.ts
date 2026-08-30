import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { ExitAttemptEvent } from '../entities/ExitAttemptEvent.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { ExecutionService, validatePercentThresholds, REDEMPTION_PLACING_TIMEOUT_MS, SIM_BUY_PLACING_STALE_MS } from './execution.service.js';
import { SimulationService } from './simulation.service.js';
import { seedDefaults } from '../seed/defaults.js';
import { PositionReservation } from '../entities/PositionReservation.js';

describe('ExecutionService simulation cash guards', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let executionService: ExecutionService;
  let simulationService: SimulationService;

  beforeEach(async () => {
    ds = await initializeDataSource(
      createTestDataSource(),
    );
    await seedDefaults(ds);
    executionService = new ExecutionService(ds);
    simulationService = new SimulationService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('rejects a second concurrent SELL claim on the same position', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'sell-a',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'SELL',
      reason: 'TRAILING',
      requestedQty: 10,
    });

    await expect(
      executionService.claim({
        orderSignalId: 'sell-b',
        copiedPositionId: pos.id,
        mode: 'sim',
        side: 'SELL',
        reason: 'TRAILING',
        requestedQty: 10,
      }),
    ).rejects.toThrow('already_claimed');
  });

  it('does not credit cash twice when a close fill is retried after filled', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const balanceRepo = ds.getRepository(SimulationBalance);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'closing',
        mode: 'sim',
        realizedPnl: 0,
      }),
    );

    await balanceRepo.save({ ...(await balanceRepo.findOne({ where: { algoKind: 'crypto' } }))!, amount: 100, baselineCapital: 100 });

    await executionService.claim({
      orderSignalId: 'sell-once',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'SELL',
      reason: 'TRAILING',
      requestedQty: 10,
    });

    const finalize = () =>
      executionService.finalize({
        orderSignalId: 'sell-once',
        status: 'filled',
        fillPrice: 0.6,
        fillQuantity: 10,
        fees: 0,
      });

    await finalize();
    const cashAfterFirst = await simulationService.getCashAmount('crypto');
    await finalize();
    const cashAfterSecond = await simulationService.getCashAmount('crypto');

    expect(cashAfterSecond).toBeCloseTo(cashAfterFirst, 6);
    expect(cashAfterFirst).toBeCloseTo(106, 4);
  });

  it('clamps leftover entry_quantity_remaining dust when a close fills below MOS', async () => {
    const posRepo = ds.getRepository(CopiedPosition);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c-dust',
        assetId: 'a-dust',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10.0003,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10.0003,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'closing',
        mode: 'real',
        realizedPnl: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'sell-dust',
      copiedPositionId: pos.id,
      mode: 'real',
      side: 'SELL',
      reason: 'SL',
      requestedQty: 10,
    });

    await executionService.finalize({
      orderSignalId: 'sell-dust',
      status: 'filled',
      fillPrice: 0.4,
      fillQuantity: 10,
      fees: 0,
    });

    const updated = await posRepo.findOneByOrFail({ id: pos.id });
    expect(updated.status).toBe('closed');
    expect(updated.quantity).toBe(0);
    expect(updated.entryQuantityRemaining).toBe(0);
  });

  it('ensureCashIntegrity repairs drift from duplicate sells', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const execRepo = ds.getRepository(Execution);
    const balanceRepo = ds.getRepository(SimulationBalance);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 0,
        entryPrice: 0.42,
        entryBidVwap: 0.42,
        entryQuantityRemaining: 0,
        entryFees: 0.0174,
        entryFeesRemaining: 0,
        status: 'closed',
        mode: 'sim',
        realizedPnl: 2.01,
        closedAt: new Date(),
      }),
    );

    await execRepo.save([
      execRepo.create({
        orderSignalId: 'buy-1',
        copiedPositionId: pos.id,
        mode: 'sim',
        side: 'BUY',
        reason: 'COPY_OPEN',
        fillPrice: 0.42,
        fillQuantity: 2.3809524,
        fees: 0.0174,
        status: 'filled',
        executedAt: new Date('2026-06-16T09:15:06Z'),
      }),
      execRepo.create({
        orderSignalId: 'sell-1',
        copiedPositionId: pos.id,
        mode: 'sim',
        side: 'SELL',
        reason: 'TRAILING',
        fillPrice: 0.85,
        fillQuantity: 2.3809524,
        fees: 0.00911,
        status: 'filled',
        executedAt: new Date('2026-06-16T10:21:42Z'),
      }),
      execRepo.create({
        orderSignalId: 'sell-2',
        copiedPositionId: pos.id,
        mode: 'sim',
        side: 'SELL',
        reason: 'TRAILING',
        fillPrice: 0.85,
        fillQuantity: 2.3809524,
        fees: 0.00911,
        status: 'filled',
        executedAt: new Date('2026-06-16T10:21:42.500Z'),
      }),
    ]);

    await balanceRepo.save({ ...(await balanceRepo.findOne({ where: { algoKind: 'crypto' } }))!, amount: 7.96, baselineCapital: 50 });

    const result = await simulationService.ensureCashIntegrity('crypto');
    expect(result.repaired).toBe(true);
    expect(result.expectedCash).toBeCloseTo(50.997, 2);

    const balance = await balanceRepo.findOne({ where: { algoKind: 'crypto' } });
    expect(balance?.amount).toBeCloseTo(result.expectedCash, 4);
    expect(balance?.baselineCapital).toBe(50);
  });

  it('recomputes unrealized PnL after a COPY_INCREASE fill', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const execRepo = ds.getRepository(Execution);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.48,
        executableBidVwap: 0.55,
        entryQuantityRemaining: 10,
        entryFees: 0.1,
        entryFeesRemaining: 0.1,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
        unrealizedPnl: -6,
      }),
    );

    await execRepo.save(
      execRepo.create({
        orderSignalId: 'buy-more',
        copiedPositionId: pos.id,
        mode: 'sim',
        side: 'BUY',
        reason: 'COPY_INCREASE',
        status: 'placing',
      }),
    );

    await executionService.finalize({
      orderSignalId: 'buy-more',
      status: 'filled',
      fillPrice: 0.52,
      fillQuantity: 10,
      fees: 0.1,
      entryBidVwap: 0.5,
    });

    const updated = await posRepo.findOneByOrFail({ id: pos.id });
    expect(updated.quantity).toBe(20);
    expect(updated.unrealizedPnl).toBeCloseTo(0.6, 4);
  });

  it('caps SELL fillQuantity to requestedQty on finalize', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const execRepo = ds.getRepository(Execution);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'closing',
        mode: 'real',
        realizedPnl: 0,
      }),
    );

    await execRepo.save(
      execRepo.create({
        orderSignalId: 'sell-cap',
        copiedPositionId: pos.id,
        mode: 'real',
        side: 'SELL',
        reason: 'SL',
        status: 'placing',
        requestedQty: 10,
        fillQuantity: 0,
      }),
    );

    await executionService.finalize({
      orderSignalId: 'sell-cap',
      status: 'filled',
      fillPrice: 0.6,
      fillQuantity: 15,
      fees: 0,
    });

    const exec = await execRepo.findOneByOrFail({ orderSignalId: 'sell-cap' });
    expect(exec.fillQuantity).toBe(10);

    const updated = await posRepo.findOneByOrFail({ id: pos.id });
    expect(updated.quantity).toBe(0);
    expect(updated.status).toBe('closed');
  });

  it('increments forced exit counters on retryable SELL failure and resets on fill', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'closing',
        mode: 'sim',
        realizedPnl: 0,
        forcedExitFailedAttempts: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'sell-fail',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'SELL',
      reason: 'TP',
      requestedQty: 10,
      referenceVwap: 0.55,
    });

    await executionService.finalize({
      orderSignalId: 'sell-fail',
      status: 'failed',
      fillPrice: 0,
      fillQuantity: 0,
      fees: 0,
      error: 'no_liquidity',
    });

    const afterFail = await posRepo.findOneByOrFail({ id: pos.id });
    expect(afterFail.status).toBe('open');
    expect(afterFail.forcedExitFailedAttempts).toBe(1);
    expect(afterFail.lastForcedExitAttemptAt).not.toBeNull();

    const failedExec = await ds.getRepository(Execution).findOneByOrFail({
      orderSignalId: 'sell-fail',
    });
    expect(failedExec.executedAt).toBeNull();
    expect(failedExec.createdAt).toBeInstanceOf(Date);

    const attemptRepo = ds.getRepository(ExitAttemptEvent);
    const attemptsAfterFail = await attemptRepo.find({
      where: { copiedPositionId: pos.id },
    });
    expect(attemptsAfterFail).toHaveLength(1);
    expect(attemptsAfterFail[0]!.kind).toBe('execution_failed');
    expect(attemptsAfterFail[0]!.closeReason).toBe('TP');
    expect(attemptsAfterFail[0]!.error).toBe('no_liquidity');
    expect(attemptsAfterFail[0]!.markBid).toBeCloseTo(0.55);

    // Re-finalize must not duplicate journal rows.
    await executionService.finalize({
      orderSignalId: 'sell-fail',
      status: 'failed',
      fillPrice: 0,
      fillQuantity: 0,
      fees: 0,
      error: 'no_liquidity',
    });
    expect(
      await attemptRepo.count({ where: { copiedPositionId: pos.id } }),
    ).toBe(1);

    await posRepo.update(pos.id, { status: 'closing' });
    await executionService.claim({
      orderSignalId: 'sell-fill',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'SELL',
      reason: 'TP',
      requestedQty: 10,
    });

    await executionService.finalize({
      orderSignalId: 'sell-fill',
      status: 'filled',
      fillPrice: 0.6,
      fillQuantity: 10,
      fees: 0,
    });

    const afterFill = await posRepo.findOneByOrFail({ id: pos.id });
    expect(afterFill.forcedExitFailedAttempts).toBe(0);
    expect(afterFill.lastForcedExitAttemptAt).toBeNull();
    // Journal survives successful fill / counter clear.
    expect(
      await attemptRepo.count({ where: { copiedPositionId: pos.id } }),
    ).toBe(1);
  });

  it('does not journal non-retryable forced-exit failures', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 10,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 10,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'closing',
        mode: 'sim',
        realizedPnl: 0,
        forcedExitFailedAttempts: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'sell-non-retry',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'SELL',
      reason: 'SL',
      requestedQty: 10,
    });

    await executionService.finalize({
      orderSignalId: 'sell-non-retry',
      status: 'failed',
      fillPrice: 0,
      fillQuantity: 0,
      fees: 0,
      error: 'balance_insufficient',
    });

    const afterFail = await posRepo.findOneByOrFail({ id: pos.id });
    expect(afterFail.forcedExitFailedAttempts).toBe(0);
    expect(
      await ds.getRepository(ExitAttemptEvent).count({
        where: { copiedPositionId: pos.id },
      }),
    ).toBe(0);
  });

  it('uses executedAt from finalize input for openedAt and exec.executedAt on first BUY open', async () => {
    const posRepo = ds.getRepository(CopiedPosition);
    const execRepo = ds.getRepository(Execution);
    const matchAt = new Date('2026-07-12T09:20:34.859Z');

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c1',
        assetId: 'a1',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 0,
        entryPrice: 0,
        entryBidVwap: 0,
        status: 'pending',
        mode: 'sim',
        reason: 'ALGO_OPEN',
        realizedPnl: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'algo-open-ts',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'BUY',
      reason: 'ALGO_OPEN',
      requestedQty: 5,
      referenceVwap: 0.57,
    });

    await executionService.finalize({
      orderSignalId: 'algo-open-ts',
      status: 'filled',
      fillPrice: 0.58,
      fillQuantity: 5,
      fees: 0.08,
      entryBidVwap: 0.57,
      executedAt: matchAt,
    });

    const updated = await posRepo.findOneByOrFail({ id: pos.id });
    const exec = await execRepo.findOneByOrFail({ orderSignalId: 'algo-open-ts' });

    expect(updated.status).toBe('open');
    expect(updated.openedAt?.getTime()).toBe(matchAt.getTime());
    expect(exec.executedAt?.getTime()).toBe(matchAt.getTime());
  });

  it('stamps failed pending BUY with the execution error, not reservation_released', async () => {
    const posRepo = ds.getRepository(CopiedPosition);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c-weather',
        assetId: 'a-weather',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 0,
        entryPrice: 0,
        entryBidVwap: 0,
        status: 'pending',
        mode: 'sim',
        reason: 'WEATHER_OPEN',
        realizedPnl: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'weather-open-nl',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'BUY',
      reason: 'WEATHER_OPEN',
      requestedQty: 1000,
      referenceVwap: 0.001,
    });

    await executionService.finalize({
      orderSignalId: 'weather-open-nl',
      status: 'failed',
      fillPrice: 0,
      fillQuantity: 0,
      fees: 0,
      error: 'no_liquidity',
    });

    const updated = await posRepo.findOneByOrFail({ id: pos.id });
    expect(updated.status).toBe('cancelled');
    expect(updated.openedAt).toBeNull();
    expect(updated.closeReason).toBe('no_liquidity');
    expect(updated.quantity).toBe(0);
  });

  it('falls back to reservation_released when failed BUY has no error', async () => {
    const posRepo = ds.getRepository(CopiedPosition);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c-weather-2',
        assetId: 'a-weather-2',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 0,
        entryPrice: 0,
        entryBidVwap: 0,
        status: 'pending',
        mode: 'sim',
        reason: 'WEATHER_OPEN',
        realizedPnl: 0,
      }),
    );

    await executionService.claim({
      orderSignalId: 'weather-open-blank',
      copiedPositionId: pos.id,
      mode: 'sim',
      side: 'BUY',
      reason: 'WEATHER_OPEN',
      requestedQty: 10,
    });

    await executionService.finalize({
      orderSignalId: 'weather-open-blank',
      status: 'failed',
      fillPrice: 0,
      fillQuantity: 0,
      fees: 0,
    });

    const updated = await posRepo.findOneByOrFail({ id: pos.id });
    expect(updated.status).toBe('cancelled');
    expect(updated.closeReason).toBe('reservation_released');
  });
});

describe('validatePercentThresholds (P3 helper)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makePos(overrides: Partial<CopiedPosition> = {}): CopiedPosition {
    return {
      slPercent: null,
      tpPercent: null,
      ...overrides,
    } as CopiedPosition;
  }

  it('validates positive slPercent and tpPercent', () => {
    const pos = makePos({ slPercent: 20, tpPercent: 25 });
    expect(validatePercentThresholds(pos)).toBe(true);
  });

  it('rejects zero slPercent', () => {
    const pos = makePos({ slPercent: 0, tpPercent: 25 });
    expect(validatePercentThresholds(pos)).toBe(false);
  });

  it('rejects negative tpPercent', () => {
    const pos = makePos({ slPercent: 20, tpPercent: -5 });
    expect(validatePercentThresholds(pos)).toBe(false);
  });

  it('accepts null thresholds', () => {
    const pos = makePos({ slPercent: null, tpPercent: null });
    expect(validatePercentThresholds(pos)).toBe(true);
  });
});

describe('ExecutionService claimUnlessFilled REDEMPTION', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let executionService: ExecutionService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    executionService = new ExecutionService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function openPosition() {
    const posRepo = ds.getRepository(CopiedPosition);
    return posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c-redeem',
        assetId: 'a-redeem',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 5,
        entryPrice: 0.8,
        entryBidVwap: 0.8,
        entryQuantityRemaining: 5,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'pending_resolution',
        mode: 'real',
        realizedPnl: 0,
      }),
    );
  }

  it('blocks reclaim while REDEMPTION is placing within timeout', async () => {
    const pos = await openPosition();
    const claimed = await executionService.claimUnlessFilled({
      orderSignalId: 'redeem-1',
      copiedPositionId: pos.id,
      mode: 'real',
      side: 'SELL',
      reason: 'REDEMPTION',
      requestedQty: 5,
    });
    expect(claimed).toBe(true);

    const again = await executionService.claimUnlessFilled({
      orderSignalId: 'redeem-1',
      copiedPositionId: pos.id,
      mode: 'real',
      side: 'SELL',
      reason: 'REDEMPTION',
      requestedQty: 5,
    });
    expect(again).toBe(false);
  });

  it('reclaims after REDEMPTION placing timeout', async () => {
    const pos = await openPosition();
    await executionService.claimUnlessFilled({
      orderSignalId: 'redeem-timeout',
      copiedPositionId: pos.id,
      mode: 'real',
      side: 'SELL',
      reason: 'REDEMPTION',
      requestedQty: 5,
    });

    const repo = ds.getRepository(Execution);
    const exec = await repo.findOneOrFail({
      where: { orderSignalId: 'redeem-timeout' },
    });
    exec.executedAt = new Date(Date.now() - REDEMPTION_PLACING_TIMEOUT_MS - 1_000);
    await repo.save(exec);

    const reclaimed = await executionService.claimUnlessFilled({
      orderSignalId: 'redeem-timeout',
      copiedPositionId: pos.id,
      mode: 'real',
      side: 'SELL',
      reason: 'REDEMPTION',
      requestedQty: 5,
    });
    expect(reclaimed).toBe(true);

    const after = await repo.findOneOrFail({
      where: { orderSignalId: 'redeem-timeout' },
    });
    expect(after.status).toBe('placing');
    expect(after.error).toBeNull();
  });
});

describe('ExecutionService.loadOrphanPlacingSim', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let executionService: ExecutionService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    executionService = new ExecutionService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function seedSimBuyPlacing(params: {
    orderSignalId: string;
    posStatus?: string;
    reservation?:
      | { createdAt: Date; expiresAt: Date }
      | 'none';
  }) {
    const posRepo = ds.getRepository(CopiedPosition);
    const execRepo = ds.getRepository(Execution);
    const resRepo = ds.getRepository(PositionReservation);

    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'c-orphan',
        assetId: 'a-orphan',
        outcome: 'Yes',
        side: 'BUY',
        quantity: 0,
        entryPrice: 0,
        entryBidVwap: 0,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: params.posStatus ?? 'pending',
        mode: 'sim',
        reason: 'ALGO_OPEN',
        realizedPnl: 0,
      }),
    );

    await execRepo.save(
      execRepo.create({
        orderSignalId: params.orderSignalId,
        copiedPositionId: pos.id,
        mode: 'sim',
        side: 'BUY',
        reason: 'ALGO_OPEN',
        status: 'placing',
      }),
    );

    if (params.reservation !== 'none') {
      const now = Date.now();
      const createdAt =
        params.reservation?.createdAt ?? new Date(now - 5_000);
      const expiresAt =
        params.reservation?.expiresAt ?? new Date(now + 120_000);
      await resRepo.save(
        resRepo.create({
          orderSignalId: params.orderSignalId,
          copiedPositionId: pos.id,
          watchlistId: 1,
          conditionId: 'c-orphan',
          assetId: 'a-orphan',
          mode: 'sim',
          reservedNotionalPusd: 5,
          reason: 'ALGO_OPEN',
          createdAt,
          expiresAt,
        }),
      );
    }

    return pos;
  }

  it('excludes BUY placing on pending with a fresh reservation', async () => {
    await seedSimBuyPlacing({ orderSignalId: 'fresh-resv' });
    const orphans = await executionService.loadOrphanPlacingSim();
    expect(orphans.map((e) => e.orderSignalId)).not.toContain('fresh-resv');
  });

  it('includes BUY placing on pending when reservation is stale', async () => {
    await seedSimBuyPlacing({
      orderSignalId: 'stale-resv',
      reservation: {
        createdAt: new Date(Date.now() - SIM_BUY_PLACING_STALE_MS - 5_000),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const orphans = await executionService.loadOrphanPlacingSim();
    expect(orphans.map((e) => e.orderSignalId)).toContain('stale-resv');
  });

  it('includes BUY placing on pending when reservation is missing', async () => {
    await seedSimBuyPlacing({ orderSignalId: 'no-resv', reservation: 'none' });
    const orphans = await executionService.loadOrphanPlacingSim();
    expect(orphans.map((e) => e.orderSignalId)).toContain('no-resv');
  });

  it('includes BUY placing on pending when reservation is expired', async () => {
    await seedSimBuyPlacing({
      orderSignalId: 'expired-resv',
      reservation: {
        createdAt: new Date(Date.now() - 5_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    const orphans = await executionService.loadOrphanPlacingSim();
    expect(orphans.map((e) => e.orderSignalId)).toContain('expired-resv');
  });

  it('includes BUY placing when position already left pending', async () => {
    await seedSimBuyPlacing({
      orderSignalId: 'cancelled-pos',
      posStatus: 'cancelled',
      reservation: 'none',
    });
    const orphans = await executionService.loadOrphanPlacingSim();
    expect(orphans.map((e) => e.orderSignalId)).toContain('cancelled-pos');
  });
});
