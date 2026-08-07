import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  AlgoMarketSelection,
  CopiedPosition,
  createAlgoSelectionServices,
  Market,
  MarketService,
  RedisQueue,
  ReservationService,
  RiskService,
  CryptoConfigService,
  SimulationService,
  type OrderSignal,
} from '@polywatch/core';
import type { MarketListItemDto } from '@polywatch/core';
import type { Redis } from 'ioredis';
import { StrategyRunner } from '../../packages/crypto-algo/src/strategy/strategy-runner.js';
import { StrategyRegistry } from '../../packages/crypto-algo/src/strategy/index.js';
import type {
  CryptoAlgoStrategy,
  AlgoSignal,
  StrategyContext,
} from '../../packages/crypto-algo/src/strategy/strategy.js';
import { CryptoAlgoPriceFeed } from '../../packages/crypto-algo/src/price-feed.js';
import { SelectionLoader } from '../../packages/crypto-algo/src/selection-loader.js';
import { runAlgoEntryPipeline } from '../../packages/crypto-algo/src/processors/algo-entry-pipeline.js';
import { PositionExitEvaluator } from '../../packages/worker/src/processors/strategy/position-exit-evaluator.js';

import { createTestDataSource } from './helpers/database.js';
import { MockRedis } from './helpers/redis-mock.js';
import { MockConnectionManager } from './helpers/connection-manager-mock.js';
import { QueueSpy } from './helpers/queue-spy.js';
import { configureCryptoAlgoRisk } from './helpers/risk-config.js';

/**
 * Deterministic test strategy that always emits a BUY YES signal when evaluated.
 * Lets us test the entry pipeline without depending on external Gamma API mocks.
 */
class TestSignalStrategy implements CryptoAlgoStrategy {
  readonly id = 'naive-momentum';

  async evaluate(
    market: MarketListItemDto,
    _ctx: StrategyContext,
  ): Promise<{ kind: 'signal'; signal: AlgoSignal } | { kind: 'abstain'; reason: 'missing_token' }> {
    if (!market.tokenIdYes) {
      return { kind: 'abstain', reason: 'missing_token' };
    }
    return {
      kind: 'signal',
      signal: {
        conditionId: market.conditionId,
        assetId: market.tokenIdYes,
        outcome: 'YES',
        side: 'BUY',
        confidence: 0.8,
        reasons: ['test strategy signal'],
        strategyId: this.id,
        interval: market.interval ?? '5m',
      },
    };
  }
}

describe('crypto-algo e2e', () => {
  let ds: DataSource;
  let redis: MockRedis;
  let redisAsRedis: Redis;
  let connectionManager: MockConnectionManager;
  let orderQueue: RedisQueue<OrderSignal>;
  let orderSpy: QueueSpy;

  beforeEach(async () => {
    ds = await createTestDataSource();
    redis = new MockRedis();
    redisAsRedis = redis as unknown as Redis;
    connectionManager = new MockConnectionManager();
    orderQueue = new RedisQueue<OrderSignal>(redisAsRedis, 'order-signals', async () => {});
    orderSpy = new QueueSpy(redis, 'order-signals');
  });

  afterEach(async () => {
    await ds.destroy();
    redis.clear();
  });

  async function setupMarketAndSelection(): Promise<{ conditionId: string; tokenIdYes: string; tokenIdNo: string }> {
    const conditionId = '0xbtc5m1234567890abcdef1234567890abcdef12';
    const tokenIdYes = '0xYES1234567890abcdef1234567890abcdef12';
    const tokenIdNo = '0xNO1234567890abcdef1234567890abcdef12';

    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const marketRepo = ds.getRepository(Market);
    await marketRepo.save(
      marketRepo.create({
        conditionId,
        question: 'Will BTC be up in 5m?',
        slug: 'btc-updown-5m-123',
        eventSlug: 'btc-updown',
        endDate: futureDate,
        acceptingOrders: true,
        closed: false,
        resolved: false,
        tokenIdYes,
        tokenIdNo,
        active: true,
        icon: null,
        category: 'Crypto',
        tagSlugs: JSON.stringify(['crypto']),
      }),
    );

    const selectionRepo = ds.getRepository(AlgoMarketSelection);
    await selectionRepo.save(
      selectionRepo.create({
        conditionId,
        question: 'Will BTC be up in 5m?',
        cryptoSymbol: 'BTC',
        interval: '5m',
        slug: 'btc-updown-5m-123',
        enabled: true,
      }),
    );

    return { conditionId, tokenIdYes, tokenIdNo };
  }

  async function buildRunner(opts?: { reEntryWindowMs?: number }): Promise<StrategyRunner> {
    const riskService = new RiskService(ds);
    const cryptoConfigService = new CryptoConfigService(ds);
    const marketService = new MarketService(ds);
    const { marketService: algoMarketService, selectionService } = createAlgoSelectionServices(ds);
    const selectionLoader = new SelectionLoader(selectionService, redis as unknown as Redis);
    await selectionLoader.load();
    const registry = new StrategyRegistry();
    registry.register(new TestSignalStrategy());

    const onSignal = async (signal: {
      conditionId: string;
      assetId: string;
      outcome: 'YES' | 'NO';
      side: 'BUY';
      confidence: number;
      reasons: string[];
      strategyId: string;
      interval: string;
    }): Promise<boolean> => {
      const risk = await cryptoConfigService.getConfig();
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
        console.log('entry pipeline skipped:', result);
        return false;
      }
      return true;
    };

    const runner = new StrategyRunner(
      selectionLoader,
      registry,
      cryptoConfigService,
      marketService,
      ds,
      selectionService,
      onSignal,
      'https://gamma-api.polymarket.com',
      opts?.reEntryWindowMs,
    );
    runner.applyRiskTunables(await cryptoConfigService.getConfig());

    return runner;
  }

  async function loadExitEvalConfigs() {
    const riskService = new RiskService(ds);
    return {
      global: await riskService.getGlobalConfig(),
      crypto: await riskService.getCryptoConfig(),
    };
  }

  /** Bid-point exit fields required since SL/TP/trailing moved off legacy percent columns. */
  function algoExitFields(overrides: Record<string, unknown> = {}) {
    return {
      slBidPoints: 0.05,
      tpBidPoints: 0.15,
      trailingBidPoints: 0.10,
      trailingActivationBidPoints: 0.05,
      peakBidVwap: null as number | null,
      ...overrides,
    };
  }

  it('detects an enabled market and opens a position when momentum fires', async () => {
    const { conditionId, tokenIdYes } = await setupMarketAndSelection();
    await configureCryptoAlgoRisk(ds);

    connectionManager.setPrice(tokenIdYes, {
      executableBidVwap: 0.59,
      executableAskVwap: 0.61,
      liquidityStatus: 'ok',
    });

    const runner = await buildRunner();
    await runner.tick();

    const buys = orderSpy.buys();
    expect(buys).toHaveLength(1);
    expect(buys[0].conditionId).toBe(conditionId);
    expect(buys[0].assetId).toBe(tokenIdYes);
    expect(buys[0].side).toBe('BUY');
    expect(buys[0].reason).toBe('ALGO_OPEN');
    expect(buys[0].mode).toBe('sim');
    expect(buys[0].quantity).toBeGreaterThan(0);
  });

  it('reacts to a real-time WebSocket price update', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { conditionId, tokenIdYes } = await setupMarketAndSelection();
    await configureCryptoAlgoRisk(ds);

    connectionManager.setPrice(tokenIdYes, {
      executableBidVwap: 0.51,
      executableAskVwap: 0.53,
      liquidityStatus: 'ok',
    });

    // Disable re-entry throttle so the WebSocket-driven eval can fire after the polling tick.
    const runner = await buildRunner({ reEntryWindowMs: 0 });
    const priceFeed = new CryptoAlgoPriceFeed();
    priceFeed.setConnectionManager(connectionManager);
    runner.setPriceFeed(priceFeed);
    await runner.connectWebSocket(connectionManager, [conditionId]);

    await runner.tick();
    // The polling tick already fired because the test strategy always signals.
    // Clear it so we can verify the WebSocket-driven signal is distinct.
    orderSpy.clear();
    expect(orderSpy.buys()).toHaveLength(0);

    // Simulate a WebSocket price update by invoking the runner's price handler directly.
    // (This bypasses the CryptoAlgoPriceFeed debounce while still exercising the
    // StrategyRunner WebSocket path: condition/asset mapping + top-of-book context.)
    await (runner as any).handlePriceUpdate(conditionId, tokenIdYes, {
      bid: 0.56,
      ask: 0.58,
      spread: 0.02,
      midPrice: 0.57,
      spreadPercent: 3.45,
      updatedAt: Date.now(),
    });

    const buys = orderSpy.buys();
    expect(buys).toHaveLength(1);
    expect(buys[0].conditionId).toBe(conditionId);
    expect(buys[0].assetId).toBe(tokenIdYes);

    runner.stop();
    vi.useRealTimers();
  });

  it('emits a stop-loss close signal when price drops below SL', async () => {
    const { conditionId, tokenIdYes } = await setupMarketAndSelection();
    await configureCryptoAlgoRisk(ds, {
      cryptoAlgoSlBidPoints: 0.10,
      cryptoAlgoSlConfirmationTicks: 1,
    });

    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId,
        assetId: tokenIdYes,
        outcome: 'Yes',
        side: 'BUY',
        quantity: 100,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 100,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
        reason: 'ALGO_OPEN',
        ...algoExitFields({ slBidPoints: 0.10 }),
      }),
    );

    const closeQueue = new RedisQueue<OrderSignal>(redis as unknown as Redis, 'close-signals', async () => {});
    const closeSpy = new QueueSpy(redis, 'close-signals');
    const evaluator = new PositionExitEvaluator(closeQueue, async () => false);

    await evaluator.evaluateCloseLogic(
      pos,
      { conditionId, acceptingOrders: true, endDate: new Date(Date.now() + 60 * 60 * 1000) } as any,
      await new RiskService(ds).getGlobalConfig(),
      (await loadExitEvalConfigs()).crypto,
      -25,
      -25,
      -25,
      -12.5,
      0.40,
      'ok',
    );

    const sells = closeSpy.sells();
    expect(sells).toHaveLength(1);
    expect(sells[0].reason).toBe('SL');
    expect(sells[0].copiedPositionId).toBe(pos.id);
    expect(sells[0].quantity).toBe(100);
  });

  it('emits a take-profit close signal when price rises above TP', async () => {
    const { conditionId, tokenIdYes } = await setupMarketAndSelection();
    await configureCryptoAlgoRisk(ds, { simTpPercent: 15 });

    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId,
        assetId: tokenIdYes,
        outcome: 'Yes',
        side: 'BUY',
        quantity: 100,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 100,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
        reason: 'ALGO_OPEN',
        ...algoExitFields({ tpBidPoints: 0.15 }),
      }),
    );

    const closeQueue = new RedisQueue<OrderSignal>(redis as unknown as Redis, 'close-signals', async () => {});
    const closeSpy = new QueueSpy(redis, 'close-signals');
    const evaluator = new PositionExitEvaluator(closeQueue, async () => false);

    await evaluator.evaluateCloseLogic(
      pos,
      { conditionId, acceptingOrders: true, endDate: new Date(Date.now() + 60 * 60 * 1000) } as any,
      await new RiskService(ds).getGlobalConfig(),
      (await loadExitEvalConfigs()).crypto,
      31,
      31,
      31,
      15.5,
      0.66,
      'ok',
    );

    const sells = closeSpy.sells();
    expect(sells).toHaveLength(1);
    expect(sells[0].reason).toBe('TP');
  });

  it('emits a trailing close signal when retracement exceeds trailing stop', async () => {
    const { conditionId, tokenIdYes } = await setupMarketAndSelection();
    await configureCryptoAlgoRisk(ds, {
      simTrailingStopPercent: 10,
      cryptoAlgoTrailingEnabled: true,
      cryptoAlgoSlConfirmationTicks: 1,
    });

    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId,
        assetId: tokenIdYes,
        outcome: 'Yes',
        side: 'BUY',
        quantity: 100,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 100,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
        reason: 'ALGO_OPEN',
        ...algoExitFields({
          slBidPoints: null,
          tpBidPoints: null,
          trailingBidPoints: 0.10,
          trailingActivationBidPoints: null,
        }),
      }),
    );
    pos.peakBidVwap = 0.60;

    const closeQueue = new RedisQueue<OrderSignal>(redis as unknown as Redis, 'close-signals', async () => {});
    const closeSpy = new QueueSpy(redis, 'close-signals');
    const evaluator = new PositionExitEvaluator(closeQueue, async () => false);

    await evaluator.evaluateCloseLogic(
      pos,
      { conditionId, acceptingOrders: true, endDate: new Date(Date.now() + 60 * 60 * 1000) } as any,
      await new RiskService(ds).getGlobalConfig(),
      (await loadExitEvalConfigs()).crypto,
      -20,
      -20,
      20,
      -10,
      0.40,
      'ok',
    );

    const sells = closeSpy.sells();
    expect(sells).toHaveLength(1);
    expect(sells[0].reason).toBe('TRAILING');
  });

  it('emits a pre-close loss signal when inside SOFT window and losing', async () => {
    const { conditionId, tokenIdYes } = await setupMarketAndSelection();
    await configureCryptoAlgoRisk(ds, {
      cryptoAlgoPreCloseEnabled: true,
      cryptoAlgoPreCloseSeconds: 120,
      cryptoAlgoPreCloseKeepEnabled: false,
    });

    const posRepo = ds.getRepository(CopiedPosition);
    const pos = await posRepo.save(
      posRepo.create({
        watchlistId: 1,
        conditionId,
        assetId: tokenIdYes,
        outcome: 'Yes',
        side: 'BUY',
        quantity: 100,
        entryPrice: 0.5,
        entryBidVwap: 0.5,
        entryQuantityRemaining: 100,
        entryFees: 0,
        entryFeesRemaining: 0,
        status: 'open',
        mode: 'sim',
        realizedPnl: 0,
        reason: 'ALGO_OPEN',
        ...algoExitFields(),
      }),
    );

    const closeQueue = new RedisQueue<OrderSignal>(redis as unknown as Redis, 'close-signals', async () => {});
    const closeSpy = new QueueSpy(redis, 'close-signals');
    const evaluator = new PositionExitEvaluator(closeQueue, async () => false);

    await evaluator.evaluateCloseLogic(
      pos,
      { conditionId, acceptingOrders: true, endDate: new Date(Date.now() + 100_000) } as any,
      await new RiskService(ds).getGlobalConfig(),
      (await loadExitEvalConfigs()).crypto,
      -3,
      -3,
      -3,
      -1.5,
      0.485,
      'ok',
    );

    const sells = closeSpy.sells();
    expect(sells).toHaveLength(1);
    expect(sells[0].reason).toBe('PRE_CLOSE_LOSS');
  });
});
