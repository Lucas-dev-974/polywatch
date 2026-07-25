import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { AlgoSurveillanceSnapshot } from '../entities/AlgoSurveillanceSnapshot.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { Market } from '../entities/Market.js';
import { seedDefaults } from '../seed/defaults.js';
import { AlgoSurveillanceService } from './algo-surveillance.service.js';

describe('AlgoSurveillanceService positions', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let service: AlgoSurveillanceService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    service = new AlgoSurveillanceService(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('listHistory attaches algo positions grouped by conditionId', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-a',
        question: 'BTC Up or Down',
        openUpPrice: 0.51,
        openDownPrice: 0.49,
        openCapturedAt: new Date('2026-01-01T00:00:05Z'),
        marketStartAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );

    const posRepo = ds.getRepository(CopiedPosition);
    await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'cond-a',
        assetId: 'asset-a',
        outcome: 'Up',
        quantity: 5,
        entryPrice: 0.52,
        entryBidVwap: 0.51,
        mode: 'sim',
        status: 'open',
        reason: 'ALGO_OPEN',
      }),
    );
    await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'cond-b',
        assetId: 'asset-b',
        outcome: 'Down',
        quantity: 2,
        entryPrice: 0.48,
        entryBidVwap: 0.47,
        mode: 'sim',
        status: 'open',
        reason: 'ALGO_OPEN',
      }),
    );

    const { items, total } = await service.listHistory();
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]!.conditionId).toBe('cond-a');
    expect(items[0]!.positions).toHaveLength(1);
    expect(items[0]!.positions[0]!.outcome).toBe('Up');
  });

  it('getByConditionId omits positions unless explicitly requested', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-a',
        openCapturedAt: new Date(),
      }),
    );

    const posRepo = ds.getRepository(CopiedPosition);
    await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'cond-a',
        assetId: 'asset-a',
        outcome: 'Up',
        quantity: 1,
        entryPrice: 0.5,
        entryBidVwap: 0.49,
        mode: 'sim',
        status: 'open',
        reason: 'ALGO_OPEN',
      }),
    );

    const lite = await service.getByConditionId('cond-a');
    expect(lite?.positions).toEqual([]);

    const full = await service.getByConditionId('cond-a', { includePositions: true });
    expect(full?.positions).toHaveLength(1);
  });

  it('listHistory resolves entryQuantityFilled for closed positions', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-a',
        openCapturedAt: new Date(),
      }),
    );

    const posRepo = ds.getRepository(CopiedPosition);
    const closed = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'cond-a',
        assetId: 'asset-a',
        outcome: 'Up',
        quantity: 0,
        entryPrice: 0.5,
        entryBidVwap: 0.49,
        mode: 'sim',
        status: 'closed',
        reason: 'ALGO_OPEN',
        realizedPnl: 0.25,
      }),
    );

    const execRepo = ds.getRepository(Execution);
    await execRepo.save(
      execRepo.create({
        orderSignalId: 'algo-buy-1',
        copiedPositionId: closed.id,
        side: 'BUY',
        status: 'filled',
        fillPrice: 0.5,
        fillQuantity: 8,
        fees: 0.01,
        reason: 'ALGO_OPEN',
        mode: 'sim',
      }),
    );

    const { items } = await service.listHistory();
    expect(items[0]!.positions[0]!.quantity).toBe(0);
    expect(items[0]!.positions[0]!.entryQuantityFilled).toBe(8);
  });

  it('listHistory resolves chart overlay fields and exitBidVwap for closed positions', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-a',
        openCapturedAt: new Date(),
      }),
    );

    const posRepo = ds.getRepository(CopiedPosition);
    const closed = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: 'cond-a',
        assetId: 'asset-exit',
        outcome: 'Up',
        quantity: 0,
        entryPrice: 0.55,
        entryBidVwap: 0.54,
        slBidPoints: 0.1,
        tpBidPoints: 0.12,
        mode: 'sim',
        status: 'closed',
        reason: 'ALGO_OPEN',
        realizedPnl: 0.1,
      }),
    );

    const execRepo = ds.getRepository(Execution);
    await execRepo.save(
      execRepo.create({
        orderSignalId: 'algo-sell-1',
        copiedPositionId: closed.id,
        side: 'SELL',
        status: 'filled',
        fillPrice: 0.62,
        fillQuantity: 5,
        fees: 0,
        reason: 'ALGO_TP',
        mode: 'sim',
      }),
    );

    const { items } = await service.listHistory();
    const summary = items[0]!.positions[0]!;
    expect(summary.assetId).toBe('asset-exit');
    expect(summary.entryBidVwap).toBe(0.54);
    expect(summary.slBidPoints).toBe(0.1);
    expect(summary.tpBidPoints).toBe(0.12);
    expect(summary.exitBidVwap).toBe(0.62);
  });

  it('resolveFallbackCloseFromMarket closes a pending snapshot from the Market table', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-resolved',
        openCapturedAt: new Date(),
      }),
    );

    const marketRepo = ds.getRepository(Market);
    await marketRepo.save(
      marketRepo.create({
        conditionId: 'cond-resolved',
        resolved: true,
        tokenIdYes: 'token-yes',
        tokenIdNo: 'token-no',
        winningTokenId: 'token-yes',
      }),
    );

    const resolved = await service.resolveFallbackCloseFromMarket('cond-resolved');
    expect(resolved).toBe(true);

    const snap = await service.getByConditionId('cond-resolved');
    expect(snap?.closeCapturedAt).not.toBeNull();
    expect(snap?.winningOutcome).toBe('Up');
    expect(snap?.closeUpPrice).toBe(1);
    expect(snap?.closeDownPrice).toBe(0);
  });

  it('markUnresolvedIfDeadlinePassed marks stale snapshots as unresolved', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-stale',
        openCapturedAt: new Date(),
        marketEndAt: new Date(Date.now() - 10 * 60_000),
      }),
    );

    const marked = await service.markUnresolvedIfDeadlinePassed(5 * 60_000);
    expect(marked).toBe(1);

    const snap = await service.getByConditionId('cond-stale');
    expect(snap?.unresolvedAt).not.toBeNull();
  });

  it('markUnresolvedIfDeadlinePassed resolves via Market table before marking unresolved', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-resolve-fallback',
        openCapturedAt: new Date(),
        marketEndAt: new Date(Date.now() - 10 * 60_000),
      }),
    );

    const marketRepo = ds.getRepository(Market);
    await marketRepo.save(
      marketRepo.create({
        conditionId: 'cond-resolve-fallback',
        resolved: true,
        tokenIdYes: 'token-yes',
        tokenIdNo: 'token-no',
        winningTokenId: 'token-no',
      }),
    );

    const marked = await service.markUnresolvedIfDeadlinePassed(5 * 60_000);
    expect(marked).toBe(0);

    const snap = await service.getByConditionId('cond-resolve-fallback');
    expect(snap?.closeCapturedAt).not.toBeNull();
    expect(snap?.winningOutcome).toBe('Down');
    expect(snap?.unresolvedAt).toBeNull();
  });

  it('resolveFallbackCloseFromMarket works when market is redeemable without resolved flag', async () => {
    const snapRepo = ds.getRepository(AlgoSurveillanceSnapshot);
    await snapRepo.save(
      snapRepo.create({
        conditionId: 'cond-closed-redeemable',
        openCapturedAt: new Date(),
      }),
    );

    const marketRepo = ds.getRepository(Market);
    await marketRepo.save(
      marketRepo.create({
        conditionId: 'cond-closed-redeemable',
        resolved: false,
        closed: true,
        acceptingOrders: false,
        tokenIdYes: '0xabc111',
        tokenIdNo: '0xdef222',
        winningTokenId: '0xabc111',
      }),
    );

    const resolved = await service.resolveFallbackCloseFromMarket('cond-closed-redeemable');
    expect(resolved).toBe(true);

    const snap = await service.getByConditionId('cond-closed-redeemable');
    expect(snap?.winningOutcome).toBe('Up');
    expect(snap?.closeUpPrice).toBe(1);
  });
});
