import { describe, it, expect, vi } from 'vitest';
import type { MoveEventDto, OrderSignal, TradingMode, CopyConfig, RedisQueue, IPolymarketConnectionManager } from '@polywatch/core';
import type { DataSource } from 'typeorm';

vi.mock('../../sizing/resolve-trader-portfolio.js', () => ({
  resolveTraderPortfolioValue: vi.fn().mockResolvedValue({ ok: true, value: 1000 }),
}));

vi.mock('../../sizing/real-cash.js', () => ({
  fetchAvailableRealCash: vi.fn().mockResolvedValue(500),
}));

// Async mock factory that re-exports everything from @polywatch/core
// but overrides computeEntryTargetQuantity to return a valid quantity.
vi.mock('@polywatch/core', async () => {
  const actual = await vi.importActual<typeof import('@polywatch/core')>('@polywatch/core');
  return {
    ...actual,
    computeEntryTargetQuantity: () => 50,
  };
});

function makeMove(overrides: Partial<MoveEventDto> = {}): MoveEventDto {
  return {
    id: 'move-1',
    traderAddress: '0xtrader',
    conditionId: '0xcond',
    assetId: '0xasset',
    outcome: 'YES',
    type: 'OPENED',
    traderSize: 100,
    previousTraderSize: 0,
    traderAvgPrice: 0.5,
    detectedAt: new Date(),
    marketMeta: { title: '', endDate: '', negativeRisk: false },
    ...overrides,
  };
}

function makeEntry() {
  return {
    id: 1,
    traderAddress: '0xtrader',
    nickname: 'trader',
    active: true,
    simEnabled: true,
    realEnabled: false,
  };
}

function makeExecutablePrices(ask = 0.5, bid = 0.48) {
  return {
    executableAskVwap: ask,
    executableBidVwap: bid,
    askLiquidityStatus: 'ok' as const,
    liquidityStatus: 'ok' as const,
  };
}

function makeConnectionManager(ask = 0.5, bid = 0.48) {
  const prices = makeExecutablePrices(ask, bid);
  return {
    fetchExecutablePrices: vi.fn().mockResolvedValue(prices),
  } as unknown as IPolymarketConnectionManager;
}

function makeCopyConfig(overrides: Partial<CopyConfig> = {}): CopyConfig {
  return {
    simSizingMode: 'fixed_usdc',
    simFixedUsdcAmount: 10,
    simMaxPositionSizeUsdc: 100,
    simMaxExposureUsdc: 1000,
    simMaxOpenPositions: 10,
    simTrailingStopPercent: null,
    simTrailingActivationPercent: null,
    simSlEnabled: true,
    simTpEnabled: true,
    simTrailingEnabled: false,
    simPreCloseEnabled: false,
    simPreCloseSeconds: 0,
    simPreCloseKeepEnabled: false,
    simPreCloseKeepBidThreshold: 0,
    simSignalScoreSizingEnabled: false,
    simMinBidToAskRatio: 0.5,
    simEntryDepthRetryMax: 3,
    simEntryDepthRetryDelayMs: 0,
    simMinTimeToClose: 0,
    simMomentumFilterEnabled: false,
    simAllowedMarketTags: [],
    simMaxDailyLossUsdc: 100,
    simKillSwitchAction: 'block_entries',
    realSizingMode: 'fixed_usdc',
    realFixedUsdcAmount: 10,
    realMaxPositionSizeUsdc: 100,
    realMaxExposureUsdc: 1000,
    realMaxOpenPositions: 10,
    realTrailingStopPercent: null,
    realTrailingActivationPercent: null,
    realSlEnabled: true,
    realTpEnabled: true,
    realTrailingEnabled: false,
    realPreCloseEnabled: false,
    realPreCloseSeconds: 0,
    realPreCloseKeepEnabled: false,
    realPreCloseKeepBidThreshold: 0,
    realSignalScoreSizingEnabled: false,
    realMinBidToAskRatio: 0.5,
    realEntryDepthRetryMax: 3,
    realEntryDepthRetryDelayMs: 0,
    realMinTimeToClose: 0,
    realMomentumFilterEnabled: false,
    realAllowedMarketTags: [],
    realMaxDailyLossUsdc: 100,
    realKillSwitchAction: 'block_entries',
    realTradingEnabled: false,
    maxSlippagePercent: 50,
    moveDetectorIntervalMs: 100,
    simInitialCapital: 1000,
    simAutoSnapshotEnabled: false,
    simAutoSnapshotIntervalSeconds: 300,
    ...overrides,
  } as CopyConfig;
}

describe('runCopyEntryPipeline', () => {
  it('propagates exception when enqueue fails after reservation', async () => {
    // Dynamic import so the mock is applied before the module is loaded
    // Increased timeout: async mocks + dynamic imports can be slow on CI
    const { runCopyEntryPipeline } = await import('./copy-entry-pipeline.js');

    const move = makeMove();
    const entry = makeEntry();
    const copyConfig = makeCopyConfig();
    const orderQueue = {
      enqueue: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
      enqueueUnique: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = makeConnectionManager();
    const marketService = {
      loadByConditionIds: vi.fn().mockResolvedValue(new Map()),
      resolvePlatformFeeParams: vi.fn().mockResolvedValue({ feeRate: 0.01, feeExponent: 1 }),
    } as any;
    const reservationService = {
      findByOrderSignalId: vi.fn().mockResolvedValue(null),
      reserve: vi.fn().mockResolvedValue({
        reservationId: 1,
        copiedPositionId: 1,
        reservedNotionalUsdc: 25,
        expiresAt: new Date(Date.now() + 120_000),
      }),
      release: vi.fn().mockResolvedValue(undefined),
    } as any;
    const simulationService = {
      getCashAmount: vi.fn().mockResolvedValue(1000),
    } as any;
    const ds = {} as DataSource;

    await expect(
      runCopyEntryPipeline({
        move,
        entry: entry as any,
        mode: 'sim' as TradingMode,
        copyConfig,
        connectionManager,
        marketService,
        reservationService,
        simulationService,
        orderQueue,
        ds,
      }),
    ).rejects.toThrow('Redis connection refused');

    expect(reservationService.release).toHaveBeenCalled();
  }, 20000);

  it('returns skip reason when reservation fails for insufficient cash', async () => {
    const { runCopyEntryPipeline } = await import('./copy-entry-pipeline.js');

    const move = makeMove();
    const entry = makeEntry();
    const copyConfig = makeCopyConfig();
    const orderQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      enqueueUnique: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = makeConnectionManager();
    const marketService = {
      loadByConditionIds: vi.fn().mockResolvedValue(new Map()),
      resolvePlatformFeeParams: vi.fn().mockResolvedValue({ feeRate: 0.01, feeExponent: 1 }),
    } as any;
    const reservationService = {
      findByOrderSignalId: vi.fn().mockResolvedValue(null),
      reserve: vi.fn().mockRejectedValue(new Error('insufficient_cash')),
      release: vi.fn().mockResolvedValue(undefined),
    } as any;
    const simulationService = {
      getCashAmount: vi.fn().mockResolvedValue(5),
    } as any;
    const ds = {} as DataSource;

    const reason = await runCopyEntryPipeline({
      move,
      entry: entry as any,
      mode: 'sim' as TradingMode,
      copyConfig,
      connectionManager,
      marketService,
      reservationService,
      simulationService,
      orderQueue,
      ds,
    });

    expect(reason).toBe('Cash simulation insuffisant');
    expect(reservationService.reserve).toHaveBeenCalled();
  });

  it('returns skip reason when reservation fails for sim copy trading disabled', async () => {
    const { runCopyEntryPipeline } = await import('./copy-entry-pipeline.js');

    const move = makeMove();
    const entry = makeEntry();
    const copyConfig = makeCopyConfig({ simCopyTradingEnabled: false });
    const orderQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      enqueueUnique: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = makeConnectionManager();
    const marketService = {
      loadByConditionIds: vi.fn().mockResolvedValue(new Map()),
      resolvePlatformFeeParams: vi.fn().mockResolvedValue({ feeRate: 0.01, feeExponent: 1 }),
    } as any;
    const reservationService = {
      findByOrderSignalId: vi.fn().mockResolvedValue(null),
      reserve: vi.fn().mockRejectedValue(new Error('sim_copy_trading_disabled')),
      release: vi.fn().mockResolvedValue(undefined),
    } as any;
    const simulationService = {
      getCashAmount: vi.fn().mockResolvedValue(1000),
    } as any;
    const ds = {} as DataSource;

    const reason = await runCopyEntryPipeline({
      move,
      entry: entry as any,
      mode: 'sim' as TradingMode,
      copyConfig,
      connectionManager,
      marketService,
      reservationService,
      simulationService,
      orderQueue,
      ds,
    });

    expect(reason).toBe('Copy trading sim désactivé (config)');
  });

  it('returns skip reason when real cash is unavailable', async () => {
    const { fetchAvailableRealCash } = await import('../../sizing/real-cash.js');
    vi.mocked(fetchAvailableRealCash).mockResolvedValueOnce(undefined);

    const { runCopyEntryPipeline } = await import('./copy-entry-pipeline.js');

    const move = makeMove();
    const entry = makeEntry();
    const copyConfig = makeCopyConfig();
    const orderQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      enqueueUnique: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = makeConnectionManager();
    const marketService = {
      loadByConditionIds: vi.fn().mockResolvedValue(new Map()),
      resolvePlatformFeeParams: vi.fn().mockResolvedValue({ feeRate: 0.01, feeExponent: 1 }),
    } as any;
    const reservationService = {
      findByOrderSignalId: vi.fn().mockResolvedValue(null),
      reserve: vi.fn(),
      release: vi.fn(),
    } as any;
    const simulationService = {
      getCashAmount: vi.fn().mockResolvedValue(1000),
    } as any;
    const ds = {} as DataSource;

    const reason = await runCopyEntryPipeline({
      move,
      entry: entry as any,
      mode: 'real' as TradingMode,
      copyConfig,
      connectionManager,
      marketService,
      reservationService,
      simulationService,
      orderQueue,
      ds,
    });

    expect(reason).toBe('Cash réel indisponible');
    expect(reservationService.reserve).not.toHaveBeenCalled();
  });

  it('resumes enqueue from existing reservation using reserved notional', async () => {
    const { runCopyEntryPipeline } = await import('./copy-entry-pipeline.js');

    const move = makeMove();
    const entry = makeEntry();
    const copyConfig = makeCopyConfig({ simMinBidToAskRatio: 0.99 });
    const orderQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      enqueueUnique: vi.fn().mockResolvedValue(false),
      acquireBoundedRetrySlot: vi.fn().mockResolvedValue(true),
    } as unknown as RedisQueue<OrderSignal>;
    const connectionManager = makeConnectionManager(0.5, 0.1);
    const marketService = {
      loadByConditionIds: vi.fn().mockResolvedValue(new Map()),
    } as any;
    const reservationService = {
      findByOrderSignalId: vi.fn().mockResolvedValue({
        reservationId: 7,
        copiedPositionId: 3,
        reservedNotionalUsdc: 25,
        expiresAt: new Date(Date.now() + 120_000),
      }),
      reserve: vi.fn(),
      release: vi.fn(),
    } as any;
    const simulationService = {
      getCashAmount: vi.fn().mockResolvedValue(1000),
    } as any;
    const ds = {} as DataSource;

    const reason = await runCopyEntryPipeline({
      move,
      entry: entry as any,
      mode: 'sim' as TradingMode,
      copyConfig,
      connectionManager,
      marketService,
      reservationService,
      simulationService,
      orderQueue,
      ds,
    });

    expect(reason).toBeNull();
    expect(reservationService.reserve).not.toHaveBeenCalled();
    expect(orderQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 7,
        copiedPositionId: 3,
        quantity: 50,
        usdcAmount: 25,
        referenceVwap: 0.5,
      }),
    );
  });
});