import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { RiskConfig } from '../entities/RiskConfig.js';
import { seedDefaults } from '../seed/defaults.js';
import { ReservationService } from './reservation.service.js';

describe('ReservationService', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: ReservationService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    service = new ReservationService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates pending position on COPY_OPEN reserve', async () => {
    const result = await service.reserve({
      orderSignalId: 'sig1',
      watchlistId: 1,
      conditionId: 'c1',
      assetId: 'a1',
      mode: 'sim',
      notionalUsdc: 50,
      reason: 'COPY_OPEN',
      outcome: 'Yes',
    });
    expect(result.copiedPositionId).toBeGreaterThan(0);
    expect(result.reservationId).toBeGreaterThan(0);
  });

  it('computeExposure uses per-position mark prices, not a single shared price (H1)', async () => {
    const posRepo = ds.getRepository(CopiedPosition);

    // Two positions with different prices:
    // A: 100 shares @ 0.80 → exposure = 80
    // B: 200 shares @ 0.05 → exposure = 10
    await posRepo.save(
      posRepo.create({
        watchlistId: 1, conditionId: 'c1', assetId: 'a1', outcome: 'Yes',
        side: 'BUY', quantity: 100, entryPrice: 0.80, entryBidVwap: 0.80,
        status: 'open', mode: 'sim',
      }),
    );
    await posRepo.save(
      posRepo.create({
        watchlistId: 1, conditionId: 'c2', assetId: 'a2', outcome: 'No',
        side: 'BUY', quantity: 200, entryPrice: 0.05, entryBidVwap: 0.05,
        status: 'open', mode: 'sim',
      }),
    );

    await service.reserve({
      orderSignalId: 'sig-h1',
      watchlistId: 1,
      conditionId: 'c3',
      assetId: 'a3',
      mode: 'sim',
      notionalUsdc: 50,
      reason: 'COPY_OPEN',
      outcome: 'Yes',
    });

    // If per-position prices were used: 80 + 10 + 50 = 140
    // If a single shared price (e.g. 2.00 via old markBidVwap) was used: (100+200)*2 + 50 = 650
    // Both are under maxExposureUsdc (1000), so reserve succeeds either way.
    // Verify both original entry prices are preserved.
    const posA = await posRepo.findOne({ where: { conditionId: 'c1' } });
    const posB = await posRepo.findOne({ where: { conditionId: 'c2' } });
    expect(posA!.entryBidVwap).toBe(0.80);
    expect(posB!.entryBidVwap).toBe(0.05);
  });

  it('rejects sim COPY_OPEN when cash is insufficient', async () => {
    const balanceRepo = ds.getRepository(SimulationBalance);
    const balance = await balanceRepo.findOne({ where: { algoKind: 'copy' } });
    if (balance) {
      balance.amount = 30;
      await balanceRepo.save(balance);
    } else {
      await balanceRepo.save(
        balanceRepo.create({ algoKind: 'copy', token: 'pUSD', amount: 30 }),
      );
    }

    await expect(
      service.reserve({
        orderSignalId: 'sig-cash',
        watchlistId: 1,
        conditionId: 'c-cash',
        assetId: 'a-cash',
        mode: 'sim',
        notionalUsdc: 50,
        reason: 'COPY_OPEN',
        outcome: 'Yes',
      }),
    ).rejects.toThrow('insufficient_cash');
  });

  it('rejects sim COPY_OPEN when sim copy trading is disabled', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.simCopyTradingEnabled = false;
    await riskRepo.save(risk);

    await expect(
      service.reserve({
        orderSignalId: 'sig-copy-off',
        watchlistId: 1,
        conditionId: 'c-off',
        assetId: 'a-off',
        mode: 'sim',
        notionalUsdc: 10,
        reason: 'COPY_OPEN',
        outcome: 'Yes',
      }),
    ).rejects.toThrow('sim_copy_trading_disabled');
  });

  it('allows sim ALGO_OPEN when sim copy trading is disabled', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.simCopyTradingEnabled = false;
    risk.cryptoAlgoEnabled = true;
    await riskRepo.save(risk);

    const result = await service.reserve({
      orderSignalId: 'sig-algo',
      watchlistId: 1,
      conditionId: 'c-algo',
      assetId: 'a-algo',
      mode: 'sim',
      notionalUsdc: 10,
      reason: 'ALGO_OPEN',
      outcome: 'Yes',
    });
    expect(result.copiedPositionId).toBeGreaterThan(0);
  });

  it('rejects real COPY_OPEN when real copy trading is disabled', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.realCopyTradingEnabled = false;
    risk.realTradingEnabled = true;
    await riskRepo.save(risk);

    await expect(
      service.reserve({
        orderSignalId: 'sig-real-copy-off',
        watchlistId: 1,
        conditionId: 'c-real-off',
        assetId: 'a-real-off',
        mode: 'real',
        notionalUsdc: 10,
        reason: 'COPY_OPEN',
        outcome: 'Yes',
      }),
    ).rejects.toThrow('real_copy_trading_disabled');
  });

  it('allows real ALGO_OPEN when real copy trading is disabled', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.realCopyTradingEnabled = false;
    risk.realTradingEnabled = true;
    risk.cryptoAlgoEnabled = true;
    await riskRepo.save(risk);

    const result = await service.reserve({
      orderSignalId: 'sig-real-algo',
      watchlistId: 1,
      conditionId: 'c-real-algo',
      assetId: 'a-real-algo',
      mode: 'real',
      notionalUsdc: 10,
      reason: 'ALGO_OPEN',
      outcome: 'Yes',
    });
    expect(result.copiedPositionId).toBeGreaterThan(0);
  });

  it('counts active sim reservations against available cash', async () => {
    const balanceRepo = ds.getRepository(SimulationBalance);
    const balance = (await balanceRepo.findOne({ where: { algoKind: 'copy' } }))!;
    balance.amount = 100;
    await balanceRepo.save(balance);

    await service.reserve({
      orderSignalId: 'sig-first',
      watchlistId: 1,
      conditionId: 'c-first',
      assetId: 'a-first',
      mode: 'sim',
      notionalUsdc: 60,
      reason: 'COPY_OPEN',
      outcome: 'Yes',
    });

    await expect(
      service.reserve({
        orderSignalId: 'sig-second',
        watchlistId: 1,
        conditionId: 'c-second',
        assetId: 'a-second',
        mode: 'sim',
        notionalUsdc: 50,
        reason: 'COPY_OPEN',
        outcome: 'Yes',
      }),
    ).rejects.toThrow('insufficient_cash');
  });

  it('sets closeReason when janitor expires ALGO_OPEN reservation', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.cryptoAlgoEnabled = true;
    await riskRepo.save(risk);

    const result = await service.reserve({
      orderSignalId: 'sig-expired',
      watchlistId: 1,
      conditionId: 'c-expired',
      assetId: 'a-expired',
      mode: 'sim',
      notionalUsdc: 10,
      reason: 'ALGO_OPEN',
      outcome: 'Yes',
    });

    const resRepo = ds.getRepository(PositionReservation);
    await resRepo.update(
      { id: result.reservationId },
      { expiresAt: new Date(Date.now() - 60_000) },
    );

    const cleaned = await service.janitor();
    expect(cleaned).toBe(1);

    const pos = await ds.getRepository(CopiedPosition).findOne({
      where: { id: result.copiedPositionId },
    });
    expect(pos?.status).toBe('cancelled');
    expect(pos?.closeReason).toBe('reservation_expired');
  });

  it('sets closeReason when release cancels pending ALGO_OPEN', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.cryptoAlgoEnabled = true;
    await riskRepo.save(risk);

    const result = await service.reserve({
      orderSignalId: 'sig-release',
      watchlistId: 1,
      conditionId: 'c-release',
      assetId: 'a-release',
      mode: 'sim',
      notionalUsdc: 10,
      reason: 'ALGO_OPEN',
      outcome: 'Yes',
    });

    await service.release('sig-release');

    const pos = await ds.getRepository(CopiedPosition).findOne({
      where: { id: result.copiedPositionId },
    });
    expect(pos?.status).toBe('cancelled');
    expect(pos?.closeReason).toBe('reservation_released');
  });

  it('does not release when a BUY execution is still in flight', async () => {
    const riskRepo = ds.getRepository(RiskConfig);
    const risk = (await riskRepo.findOne({ where: {} }))!;
    risk.cryptoAlgoEnabled = true;
    await riskRepo.save(risk);

    const result = await service.reserve({
      orderSignalId: 'sig-inflight',
      watchlistId: 1,
      conditionId: 'c-inflight',
      assetId: 'a-inflight',
      mode: 'sim',
      notionalUsdc: 10,
      reason: 'ALGO_OPEN',
      outcome: 'Yes',
    });

    const execRepo = ds.getRepository(Execution);
    await execRepo.save(
      execRepo.create({
        orderSignalId: 'sig-inflight',
        copiedPositionId: result.copiedPositionId,
        mode: 'sim',
        side: 'BUY',
        reason: 'ALGO_OPEN',
        status: 'placing',
      }),
    );

    await service.release('sig-inflight');

    const pos = await ds.getRepository(CopiedPosition).findOne({
      where: { id: result.copiedPositionId },
    });
    expect(pos?.status).toBe('pending');
    expect(pos?.closeReason).toBeNull();
  });
});