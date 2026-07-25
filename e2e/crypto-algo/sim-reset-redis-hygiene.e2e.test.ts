import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  WORKER_QUEUES,
  hashAlgoLogicalKey,
  RedisQueue,
  RiskService,
  ReservationService,
  SimulationService,
  createAlgoSelectionServices,
  collectSimRedisPurgeHints,
  purgeSimExecutionRedisState,
  CopiedPosition,
  PositionReservation,
} from '@polywatch/core';
import { runAlgoEntryPipeline } from '../../packages/crypto-algo/src/processors/algo-entry-pipeline.js';
import { createTestDataSource } from './helpers/database.js';
import { MockConnectionManager } from './helpers/connection-manager-mock.js';
import { configureCryptoAlgoRisk } from './helpers/risk-config.js';
import {
  makeAlgoBuySignal,
  seedAlgoMarketFixture,
} from './helpers/execution-hardening-fixtures.js';
import { MockRedis } from './helpers/redis-mock.js';

const ALGO_QUEUE = WORKER_QUEUES.ALGO_ORDER_SIGNALS;

function simJob(id: string) {
  return JSON.stringify({
    id,
    copiedPositionId: 1,
    conditionId: '0xcond',
    assetId: '0xasset',
    side: 'BUY',
    quantity: 5,
    reason: 'ALGO_OPEN',
    mode: 'sim',
  });
}

function realJob(id: string) {
  return JSON.stringify({
    id,
    copiedPositionId: 99,
    conditionId: '0xcond-real',
    assetId: '0xasset-real',
    side: 'BUY',
    quantity: 5,
    reason: 'ALGO_OPEN',
    mode: 'real',
  });
}

describe('sim reset redis hygiene e2e', () => {
  let ds: DataSource;
  let redis: MockRedis;

  beforeEach(async () => {
    ds = await createTestDataSource();
    redis = new MockRedis();
  });

  afterEach(async () => {
    await ds.destroy();
    redis.clear();
  });

  it('purges only sim jobs and targeted dedupe markers', async () => {
    const fixture = await seedAlgoMarketFixture(ds);
    const logicalKey = hashAlgoLogicalKey({
      conditionId: fixture.conditionId,
      interval: '5m',
      outcome: 'YES',
      strategyId: 'naive-momentum',
      mode: 'sim',
    });

    const reservationRepo = ds.getRepository(PositionReservation);
    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId: fixture.conditionId,
        assetId: fixture.tokenIdYes,
        outcome: 'YES',
        side: 'BUY',
        quantity: 0,
        entryPrice: 0,
        entryBidVwap: 0,
        status: 'pending',
        mode: 'sim',
        reason: 'ALGO_OPEN',
      }),
    );
    await reservationRepo.save(
      reservationRepo.create({
        orderSignalId: 'sim-signal-1',
        copiedPositionId: pos.id,
        watchlistId: 1,
        conditionId: fixture.conditionId,
        assetId: fixture.tokenIdYes,
        mode: 'sim',
        reservedNotionalUsdc: 3,
        reason: 'ALGO_OPEN',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 180_000),
      }),
    );

    const hints = await collectSimRedisPurgeHints(ds);
    expect(hints.algoLogicalKeys).toContain(logicalKey);
    expect(hints.copySignalIds).toContain('sim-signal-1');

    await redis.rpush(ALGO_QUEUE, simJob('sim-1'), realJob('real-1'));
    await redis.set(`${ALGO_QUEUE}:enqueued:${logicalKey}`, '1', 'EX', 180);
    await redis.set(`${ALGO_QUEUE}:enqueued:${logicalKey}-real`, '1', 'EX', 180);
    await redis.set('algo-entry-cooldown:0xcond:sim', '1', 'EX', 30);
    await redis.set('algo-entry-cooldown:0xcond:real', '1', 'EX', 30);

    const result = await purgeSimExecutionRedisState(redis as never, hints);

    expect(result.algoOrderSignalsRemoved).toBe(1);
    expect(redis.getQueue(ALGO_QUEUE)).toEqual([realJob('real-1')]);
    expect(await redis.exists(`${ALGO_QUEUE}:enqueued:${logicalKey}`)).toBe(0);
    expect(await redis.exists(`${ALGO_QUEUE}:enqueued:${logicalKey}-real`)).toBe(1);
    expect(await redis.exists('algo-entry-cooldown:0xcond:sim')).toBe(0);
    expect(await redis.exists('algo-entry-cooldown:0xcond:real')).toBe(1);
  });

  it('purge clears stale dedup so a fresh pipeline run can enqueue', async () => {
    const fixture = await seedAlgoMarketFixture(ds);
    const logicalKey = hashAlgoLogicalKey({
      conditionId: fixture.conditionId,
      interval: '5m',
      outcome: 'YES',
      strategyId: 'naive-momentum',
      mode: 'sim',
    });

    const redisAsRedis = redis as never;
    const orderQueue = new RedisQueue(redisAsRedis, ALGO_QUEUE, async () => {});
    await orderQueue.enqueueUnique(
      JSON.parse(simJob('stale')) as never,
      logicalKey,
      180,
    );

    const hints = await collectSimRedisPurgeHints(ds);
    await purgeSimExecutionRedisState(redisAsRedis, hints);

    await configureCryptoAlgoRisk(ds);
    const connectionManager = new MockConnectionManager();
    connectionManager.setPrice(fixture.tokenIdYes, {
      executableBidVwap: 0.59,
      executableAskVwap: 0.61,
      liquidityStatus: 'ok',
    });
    connectionManager.setOrderBook(
      fixture.tokenIdYes,
      [{ price: 0.59, size: 100 }],
      [{ price: 0.61, size: 100 }],
    );

    const riskService = new RiskService(ds);
    const riskConfig = await riskService.getConfig();
    const { marketService } = createAlgoSelectionServices(ds);

    const pipelineResult = await runAlgoEntryPipeline({
      signal: makeAlgoBuySignal(fixture),
      risk: riskConfig,
      watchlistId: 1,
      connectionManager,
      reservationService: new ReservationService(ds),
      simulationService: new SimulationService(ds),
      marketService,
      orderQueue,
      redisCmd: redisAsRedis,
      ds,
      backendUrl: 'http://localhost:3000',
      serviceToken: 'dev-token',
    });

    expect(pipelineResult).toBeNull();
    expect(redis.getQueue(ALGO_QUEUE).length).toBe(1);

    const pending = await ds.query(
      `SELECT COUNT(*)::int AS n FROM copied_positions WHERE status = 'pending' AND mode = 'sim'`,
    );
    expect(pending[0]?.n).toBe(1);
  });
});
