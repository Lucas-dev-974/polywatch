import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  ALGO_SELECTIONS_CHANGED_CHANNEL,
  CopiedPosition,
  ENTRY_ENQUEUE_MAX_RETRIES_PER_RESERVATION,
  Execution,
  ExecutionService,
  RedisQueue,
  ReservationService,
  RiskService,
  SimulationService,
  WORKER_QUEUES,
  createAlgoSelectionServices,
  enqueueEntrySignal,
  hasAlgoEntryCooldown,
  publishAlgoSelectionsChanged,
  setAlgoEntryCooldown,
  type OrderSignal,
} from '@polywatch/core';
import { runAlgoEntryPipeline } from '../../packages/crypto-algo/src/processors/algo-entry-pipeline.js';
import { ResultsConsumer } from '../../packages/worker/src/processors/results-consumer.js';
import { PositionLockRegistry } from '../../packages/worker/src/clob/position-lock-registry.js';
import * as syncBookSubscriptionsModule from '../../packages/worker/src/polymarket/sync-book-subscriptions.js';

import { createTestDataSource } from './helpers/database.js';
import { MockRedis } from './helpers/redis-mock.js';
import { MockConnectionManager } from './helpers/connection-manager-mock.js';
import { configureCryptoAlgoRisk } from './helpers/risk-config.js';
import {
  makeAlgoBuySignal,
  seedAlgoMarketFixture,
  type MarketFixture,
} from './helpers/execution-hardening-fixtures.js';

const QUEUE = WORKER_QUEUES.ALGO_ORDER_SIGNALS;

function sampleJob(overrides?: Partial<OrderSignal>): OrderSignal {
  return {
    id: 'sig-hardening-e2e',
    copiedPositionId: 1,
    reservationId: 10,
    conditionId: '0xcond',
    assetId: '0xasset',
    side: 'BUY',
    quantity: 5,
    usdcAmount: 3,
    orderType: 'FOK',
    referenceVwap: 0.6,
    reason: 'ALGO_OPEN',
    mode: 'sim',
    ...overrides,
  };
}

/**
 * Autonomous e2e for PR1 execution hardening (bounded enqueue, resume anti-spam,
 * cooldown, selections-changed). Uses in-memory SQLite + MockRedis — no live
 * worker, Postgres, or Polymarket network required.
 */
describe('crypto-algo execution hardening e2e (autonomous)', () => {
  let ds: DataSource;
  let redis: MockRedis;
  let redisAsRedis: Redis;
  let connectionManager: MockConnectionManager;
  let orderQueue: RedisQueue<OrderSignal>;
  let fixture: MarketFixture;

  beforeEach(async () => {
    ds = await createTestDataSource();
    redis = new MockRedis();
    redisAsRedis = redis as unknown as Redis;
    connectionManager = new MockConnectionManager();
    orderQueue = new RedisQueue<OrderSignal>(redisAsRedis, QUEUE, async () => {});
    fixture = await seedAlgoMarketFixture(ds);
    await configureCryptoAlgoRisk(ds);

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
  });

  afterEach(async () => {
    await ds.destroy();
    redis.clear();
  });

  async function runPipelineOnce() {
    const riskService = new RiskService(ds);
    const { marketService } = createAlgoSelectionServices(ds);
    const risk = await riskService.getCryptoConfig();
    return runAlgoEntryPipeline({
      signal: makeAlgoBuySignal(fixture),
      risk,
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
  }

  describe('Phase 0 — bounded enqueue', () => {
    it('limits force re-enqueues under tick spam (worker-down simulation)', async () => {
      const job = sampleJob();
      let successCount = 0;

      for (let i = 0; i < 25; i++) {
        const ok = await enqueueEntrySignal({
          orderQueue,
          job,
          dedupeKey: 'market-logical-key',
          ttlSeconds: 180,
          hasBuyExecution: async () => false,
        });
        if (ok) successCount++;
      }

      const depth = redis.getQueue(QUEUE).length;
      const maxAllowed = 1 + ENTRY_ENQUEUE_MAX_RETRIES_PER_RESERVATION;

      expect(depth).toBeLessThanOrEqual(maxAllowed);
      expect(successCount).toBeLessThanOrEqual(maxAllowed);
      expect(depth).toBeGreaterThan(0);
    });

    it('does not force-enqueue while a BUY execution is in flight', async () => {
      await orderQueue.enqueueUnique(sampleJob(), 'market-logical-key', 180);

      const ok = await enqueueEntrySignal({
        orderQueue,
        job: sampleJob({ id: 'sig-retry-blocked' }),
        dedupeKey: 'market-logical-key',
        ttlSeconds: 180,
        hasBuyExecution: async () => false,
        hasInFlightBuy: async () => true,
      });

      expect(ok).toBe(false);
      expect(redis.getQueue(QUEUE)).toHaveLength(1);
    });

    it('allows janitor dedupe key to retry independently of market logical key', async () => {
      await orderQueue.enqueueUnique(sampleJob(), 'market-logical-key', 180);

      const janitorOk = await enqueueEntrySignal({
        orderQueue,
        job: sampleJob({ id: 'sig-janitor', copiedPositionId: 99 }),
        dedupeKey: 'janitor:99',
        ttlSeconds: 120,
        hasBuyExecution: async () => false,
      });

      expect(janitorOk).toBe(true);
      expect(redis.getQueue(QUEUE).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Phase 4a — resume anti-spam', () => {
    it('enqueues once then noop on repeated pipeline ticks while dedup marker is active', async () => {
      const first = await runPipelineOnce();
      expect(first).toBeNull();

      const depthAfterFirst = redis.getQueue(QUEUE).length;
      expect(depthAfterFirst).toBe(1);

      const second = await runPipelineOnce();
      expect(second).toBeNull();
      expect(redis.getQueue(QUEUE)).toHaveLength(depthAfterFirst);
    });
  });

  describe('Phase 4b — execution cooldown', () => {
    it('blocks a new entry while cooldown key is set', async () => {
      await setAlgoEntryCooldown(redisAsRedis, fixture.conditionId, 'sim', 30);

      const result = await runPipelineOnce();
      expect(result).toBe('Aucun mode exécutable');
      expect(redis.getQueue(QUEUE)).toHaveLength(0);
      expect(await hasAlgoEntryCooldown(redisAsRedis, fixture.conditionId, 'sim')).toBe(
        true,
      );
    });

    it('ResultsConsumer sets cooldown after failed ALGO_OPEN BUY', async () => {
      const syncSpy = vi
        .spyOn(syncBookSubscriptionsModule, 'syncBookSubscriptions')
        .mockResolvedValue(undefined);

      const positionRepo = ds.getRepository(CopiedPosition);
      const pos = await positionRepo.save(
        positionRepo.create({
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

      const orderSignalId = `failed-algo-open-e2e-${Date.now()}`;

      const execRepo = ds.getRepository(Execution);
      await execRepo.save(
        execRepo.create({
          orderSignalId,
          copiedPositionId: pos.id,
          mode: 'sim',
          side: 'BUY',
          orderType: 'FAK',
          requestedQty: 5,
          status: 'placing',
          reason: 'ALGO_OPEN',
        }),
      );

      const closeQueue = new RedisQueue<OrderSignal>(
        redisAsRedis,
        'close-signals',
        async () => {},
      );
      const consumer = new ResultsConsumer(
        ds,
        connectionManager as never,
        new PositionLockRegistry(),
        closeQueue,
        redisAsRedis,
      );

      await consumer.handle({
        orderSignalId,
        mode: 'sim',
        status: 'failed',
        fillPrice: 0,
        fillQuantity: 0,
        fees: 0,
        error: 'order_not_matched',
        reason: 'ALGO_OPEN',
        executedAt: new Date(),
      });

      expect(await hasAlgoEntryCooldown(redisAsRedis, fixture.conditionId, 'sim')).toBe(
        true,
      );

      const blocked = await runPipelineOnce();
      expect(blocked).toBe('Aucun mode exécutable');
      syncSpy.mockRestore();
    });
  });

  describe('Phase 3 — algo-selections-changed', () => {
    it('publishAlgoSelectionsChanged delivers payload to subscribers', async () => {
      const received: string[] = [];
      redis.on('message', (channel: string, payload: string) => {
        if (channel === ALGO_SELECTIONS_CHANGED_CHANNEL) received.push(payload);
      });
      await redis.subscribe(ALGO_SELECTIONS_CHANGED_CHANNEL);

      await publishAlgoSelectionsChanged(redisAsRedis, { added: 2, disabled: 1 });

      expect(received).toHaveLength(1);
      const parsed = JSON.parse(received[0]!) as { added: number; disabled: number };
      expect(parsed.added).toBe(2);
      expect(parsed.disabled).toBe(1);
      expect(typeof parsed.at).toBe('number');
    });
  });

  describe('integration — happy path preserved', () => {
    it('single pipeline run creates one reservation and one queue job', async () => {
      const result = await runPipelineOnce();
      expect(result).toBeNull();

      const jobs = redis.getQueue(QUEUE);
      expect(jobs).toHaveLength(1);

      const job = JSON.parse(jobs[0]!) as OrderSignal;
      expect(job.reason).toBe('ALGO_OPEN');
      expect(job.mode).toBe('sim');
      expect(job.conditionId).toBe(fixture.conditionId);

      const reservations = await ds.query(
        `SELECT COUNT(*)::int AS n FROM position_reservations WHERE reason = 'ALGO_OPEN'`,
      );
      expect(reservations[0]?.n).toBe(1);

      const executionService = new ExecutionService(ds);
      const pending = await ds.query(
        `SELECT id FROM copied_positions WHERE status = 'pending' AND reason = 'ALGO_OPEN'`,
      );
      expect(pending).toHaveLength(1);
      expect(
        await executionService.hasBuyForPosition(Number(pending[0].id)),
      ).toBe(false);
    });
  });
});
