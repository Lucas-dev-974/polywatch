import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  AlgoMarketSelection,
  CopiedPosition,
  Execution,
  ExecutionService,
  MarketService,
  OPEN_LIKE_POSITION_STATUSES,
  RedisQueue,
  ReservationService,
  RiskService,
  SimulationBalance,
  SimulationService,
  createAlgoSelectionServices,
  createDataSource,
  initializeDataSource,
  seedDefaults,
  sleep,
  type ExecutionResult,
  type OrderSignal,
} from '@polywatch/core';
import type { Redis } from 'ioredis';
import { StrategyRunner } from '../../packages/crypto-algo/src/strategy/strategy-runner.js';
import { StrategyRegistry, NaiveMomentumStrategy } from '../../packages/crypto-algo/src/strategy/index.js';
import { CryptoAlgoPriceFeed } from '../../packages/crypto-algo/src/price-feed.js';
import { SelectionLoader } from '../../packages/crypto-algo/src/selection-loader.js';
import { runAlgoEntryPipeline } from '../../packages/crypto-algo/src/processors/algo-entry-pipeline.js';
import { PolymarketConnectionManager } from '../../packages/worker/src/polymarket/connection-manager.js';
import { Executor } from '../../packages/worker/src/processors/executor.js';
import { StrategyProcessing } from '../../packages/worker/src/processors/strategy-processing.js';
import { PositionLockRegistry } from '../../packages/worker/src/clob/position-lock-registry.js';
import { executionResultToFinalizeInput } from '../../packages/worker/src/clob/execution-completion.js';

import { createTestDataSource } from './helpers/database.js';
import { MockRedis } from './helpers/redis-mock.js';
import { configureCryptoAlgoRisk } from './helpers/risk-config.js';
import { drainQueue } from './helpers/queue-drainer.js';
import { discoverActiveCrypto5mMarket } from './helpers/real-market-discovery.js';

/**
 * Full-chain e2e test on REAL Polymarket data (Gamma API + CLOB REST + WebSocket)
 * in simulation mode.
 *
 * Gated by RUN_REAL_SIM_E2E=1 because it requires network access to Polymarket
 * and can run for several minutes while waiting for the real market price to
 * cross the strategy threshold.
 */
describe.skipIf(!process.env.RUN_REAL_SIM_E2E)(
  'crypto-algo real-sim e2e (live Polymarket data)',
  () => {
    let ds: DataSource;
    let redis: MockRedis;
    let redisAsRedis: Redis;
    let connectionManager: PolymarketConnectionManager;
    let orderQueue: RedisQueue<OrderSignal>;
    let closeQueue: RedisQueue<OrderSignal>;
    let resultsQueue: RedisQueue<ExecutionResult>;
    let positionLocks: PositionLockRegistry;
    let executorA: Executor;
    let executorB: Executor;
    let strategy: StrategyProcessing;
    let executionService: ExecutionService;
    let runner: StrategyRunner;
    let priceFeed: CryptoAlgoPriceFeed;
    const pendingAsyncOps = new Set<Promise<unknown>>();

    function track<T>(promise: Promise<T>): Promise<T> {
      pendingAsyncOps.add(promise);
      promise.finally(() => pendingAsyncOps.delete(promise));
      return promise;
    }

    beforeEach(async () => {
      ds = await createTestDataSource();
      redis = new MockRedis();
      redisAsRedis = redis as unknown as Redis;

      connectionManager = new PolymarketConnectionManager();
      positionLocks = new PositionLockRegistry();

      orderQueue = new RedisQueue<OrderSignal>(redisAsRedis, 'order-signals', async () => {});
      closeQueue = new RedisQueue<OrderSignal>(redisAsRedis, 'close-signals', async () => {});
      resultsQueue = new RedisQueue<ExecutionResult>(redisAsRedis, 'execution-results', async () => {});

      executorA = new Executor(ds, connectionManager, resultsQueue, positionLocks);
      executorB = new Executor(ds, connectionManager, resultsQueue, positionLocks);
      strategy = new StrategyProcessing(ds, connectionManager, closeQueue);
      executionService = new ExecutionService(ds);
    });

    afterEach(async () => {
      try {
        connectionManager?.setOnBookUpdate(() => {});
      } catch { /* noop */ }
      try {
        priceFeed?.setOnPriceUpdate(() => {});
      } catch { /* noop */ }
      try {
        runner?.stop();
      } catch { /* noop */ }
      try {
        priceFeed?.disconnect();
      } catch { /* noop */ }
      try {
        connectionManager?.getWsClient().disconnect();
      } catch { /* noop */ }
      if (pendingAsyncOps.size > 0) {
        await Promise.allSettled(pendingAsyncOps);
      }
      redis?.clear();
      await ds?.destroy();
    });

    async function handleResult(result: ExecutionResult): Promise<void> {
      const input = executionResultToFinalizeInput(result);
      await executionService.finalize(input);
    }

    async function drainAllQueues(): Promise<void> {
      await drainQueue(redis, 'order-signals', (s) => executorA.handle(s));
      await drainQueue(redis, 'close-signals', (s) => executorB.handle(s));
      await drainQueue(redis, 'execution-results', (r) => handleResult(r));
    }

    it(
      'opens and closes a sim position on a real crypto 5m market',
      async () => {
        // --- Risk config ---
        await configureCryptoAlgoRisk(ds);

        // --- Discover a live crypto 5m market ---
        const market = await discoverActiveCrypto5mMarket(ds);
        const { conditionId, tokenIdYes } = market;

        // --- Build the StrategyRunner with the real NaiveMomentumStrategy ---
        const riskService = new RiskService(ds);
        const marketService = new MarketService(ds);
        const { marketService: algoMarketService, selectionService } =
          createAlgoSelectionServices(ds);
        const selectionLoader = new SelectionLoader(
          selectionService,
          redisAsRedis,
        );
        await selectionLoader.load();
        const registry = new StrategyRegistry();
        registry.register(new NaiveMomentumStrategy());

        const onSignal = async (signal: {
          conditionId: string;
          assetId: string;
          outcome: 'YES' | 'NO';
          side: 'BUY';
          confidence: number;
          reasons: string[];
          strategyId: string;
          interval: string;
        }) => {
          const risk = await riskService.getConfig();
          const result = await runAlgoEntryPipeline({
            signal,
            risk,
            watchlistId: 1,
            connectionManager,
            reservationService: new ReservationService(ds),
            simulationService: new SimulationService(ds),
            marketService: algoMarketService,
            orderQueue,
            redisCmd: redisAsRedis,
            ds,
            backendUrl: 'http://localhost:3000',
            serviceToken: 'dev-token',
          });
          if (result !== null) {
            console.log('[real-sim] entry pipeline skipped:', result);
          }
        };

        runner = new StrategyRunner(
          selectionLoader,
          registry,
          riskService,
          marketService,
          ds,
          selectionService,
          onSignal,
          'https://gamma-api.polymarket.com',
        );

        // --- WebSocket setup (combined callback for entries + exits) ---
        priceFeed = new CryptoAlgoPriceFeed();
        priceFeed.setOnPriceUpdate((cid, assetId, topOfBook) => {
          track((runner as any).handlePriceUpdate(cid, assetId, topOfBook));
        });
        // setConnectionManager registers cm.setOnBookUpdate → priceFeed.handleBookUpdate
        priceFeed.setConnectionManager(connectionManager);
        // Override with combined callback: price feed (entries) + strategy.evaluateAll (exits)
        connectionManager.setOnBookUpdate((assetId: string) => {
          (priceFeed as any).handleBookUpdate(assetId);
          track(strategy.evaluateAll());
        });

        let wsConnected = false;
        try {
          await priceFeed.connect();
          await priceFeed.subscribeToMarkets([conditionId], marketService);
          wsConnected = true;
          console.log('[real-sim] WebSocket connected, subscribed to', conditionId);
        } catch (err) {
          console.warn('[real-sim] WS connect failed — falling back to polling:', err);
        }

        // --- Phase 1: wait for the strategy to open a position ---
        const ENTRY_DEADLINE = Date.now() + 10 * 60_000;
        let position: CopiedPosition | null = null;

        while (Date.now() < ENTRY_DEADLINE) {
          await runner.tick();
          await drainAllQueues();

          position = await ds
            .getRepository(CopiedPosition)
            .findOne({ where: { mode: 'sim', conditionId } });
          if (position && OPEN_LIKE_POSITION_STATUSES.includes(position.status)) break;

          await sleep(5_000);
        }

        expect(position, 'aucune position ouverte dans le délai (10 min)').toBeTruthy();
        console.log(JSON.stringify({
          e2e_position: 'open',
          runId: process.env.E2E_RUN_ID,
          conditionId,
          marketQuestion: market.question,
          cryptoSymbol: market.cryptoSymbol,
          interval: market.interval,
          outcome: position!.outcome,
          side: 'BUY',
          entryPrice: position!.entryPrice,
          quantity: position!.quantity,
          openedAt: new Date().toISOString(),
        }));

        // --- Phase 2: wait for the position to close (SL/TP/trailing/pre-close) ---
        const EXIT_DEADLINE = Date.now() + 10 * 60_000;
        let closed: CopiedPosition | null = null;

        while (Date.now() < EXIT_DEADLINE) {
          // Manual fallback in case WS hasn't pushed a recent event
          await strategy.evaluateAll();
          await drainAllQueues();

          // Live price update marker (best-effort, no impact on test flow)
          const prices = priceFeed.getOutcomePrices(conditionId);
          if (prices?.upPrice != null) {
            const currentPrice = prices.upPrice;
            const pnlPercent = ((currentPrice - position!.entryPrice) / position!.entryPrice) * 100;
            console.log(JSON.stringify({
              e2e_position: 'update',
              runId: process.env.E2E_RUN_ID,
              conditionId,
              currentPrice,
              pnlPercent,
            }));
          }

          closed = await ds
            .getRepository(CopiedPosition)
            .findOne({ where: { id: position!.id } });
          if (closed && !OPEN_LIKE_POSITION_STATUSES.includes(closed.status)) break;

          await sleep(5_000);
        }

        expect(closed, 'position non clôturée dans le délai (10 min)').toBeTruthy();
        expect(closed!.status).toBe('closed');

        const closeReason = closed!.closeReason;
        console.log(JSON.stringify({
          e2e_position: 'close',
          runId: process.env.E2E_RUN_ID,
          conditionId,
          closeReason,
          realizedPnl: closed!.realizedPnl,
          closedAt: new Date().toISOString(),
        }));

        // --- Structural assertions ---
        expect([
          'SL',
          'TP',
          'TRAILING',
          'PRE_CLOSE_LOSS',
          'PRE_CLOSE_WIN',
          'KILL_SWITCH',
          'REDEMPTION',
        ]).toContain(closeReason);

        const execs = await ds.getRepository(Execution).find({
          where: { copiedPositionId: closed!.id },
        });
        const entryExec = execs.find((e) => e.side === 'BUY');
        const exitExec = execs.find((e) => e.side === 'SELL');
        expect(entryExec, 'execution entry manquante').toBeTruthy();
        expect(entryExec!.status).toBe('filled');
        expect(exitExec, 'execution exit manquante').toBeTruthy();
        expect(exitExec!.status).toBe('filled');

        const balance = await ds
          .getRepository(SimulationBalance)
          .findOne({ where: {} });
        expect(balance, 'SimulationBalance manquante').toBeTruthy();
        expect(balance!.amount).toBeLessThan(balance!.baselineCapital);

        // --- Coherence assertion per mechanism ---
        const entryValue = position!.entryPrice * position!.quantity;
        switch (closeReason) {
          case 'SL':
            expect(closed!.realizedPnl).toBeLessThan(0);
            expect(Math.abs(closed!.realizedPnl)).toBeCloseTo(entryValue * 0.05, 1);
            break;
          case 'TP':
            expect(closed!.realizedPnl).toBeGreaterThan(0);
            expect(closed!.realizedPnl).toBeCloseTo(entryValue * 0.15, 1);
            break;
          case 'TRAILING':
            expect(closed!.realizedPnl).toBeGreaterThan(0);
            break;
          case 'PRE_CLOSE_LOSS':
            expect(closed!.realizedPnl).toBeLessThan(0);
            break;
          case 'PRE_CLOSE_WIN':
            expect(closed!.realizedPnl).toBeGreaterThanOrEqual(0);
            break;
        }
      },
      20 * 60_000,
    );
  },
);