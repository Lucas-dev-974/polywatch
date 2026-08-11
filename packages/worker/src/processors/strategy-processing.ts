import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import {
  CopiedPosition,
  CopiedPositionService,
  ExecutionService,
  computeTopOfBook,
  getMaxPreCloseSeconds,
  isAnyPreCloseEnabled,
  resolveWeatherPreCloseAggregate,
  isMarketTerminal,
  isPreCloseMonitoringScope,
  Market,
  MarketService,
  resolveLiveCloseableBid,
  resolveMarketInterval,
  GlobalConfigService,
  CopyConfigService,
  CryptoConfigService,
  WeatherConfigService,
  getAlgoKindForPosition,
  OPEN_LIKE_POSITION_STATUSES,
} from '@polywatch/core';
import type { OrderSignal, PnlTick, MarketTick, LiquidityStatus, GlobalConfig, CopyConfig, CryptoConfig, WeatherConfig } from '@polywatch/core';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import type { RedisQueue } from '../queue/redis-queue.js';
import { safeInterval } from '../helpers.js';
import {
  MARKET_REFRESH_THROTTLE_MS,
  KILL_SWITCH_CHECK_INTERVAL_MS,
  STRATEGY_EVAL_INTERVAL_MS,
} from '../constants.js';
import { config } from '../config.js';
import { resolveMarkState, resolveMarkBidForExit } from './strategy/position-evaluator.js';
import {
  evaluateIlliquidPosition,
  evaluateLiquidPosition,
} from './strategy/position-branches.js';
import { KillSwitchMonitor } from './strategy/kill-switch-monitor.js';
import { PnlTickPublisher } from './strategy/pnl-tick-publisher.js';
import { MarketTickPublisher } from './strategy/market-tick-publisher.js';
import { PositionExitEvaluator, type MosResolver } from './strategy/position-exit-evaluator.js';
import {
  loadRealClobMarketInfoLookup,
  minSellQuantityViolation,
} from '../clob/min-order-size.js';
import pino from 'pino';
import { notifyBackendAlert } from '../clob/notify-alert.js';
import { buildStrategyCycleMetricsSnapshot } from '../strategy-cycle-metrics.js';

const log = pino({ name: 'strategy-processing' });

/** P0: avoid 10 Hz strategy-cycle POSTs; gauges only need ~1 Hz. */
const STRATEGY_METRICS_PUSH_MIN_INTERVAL_MS = 1_000;

export class StrategyProcessing {
  private positionService: CopiedPositionService;
  private marketService: MarketService;
  private globalConfigService: GlobalConfigService;
  private copyConfigService: CopyConfigService;
  private cryptoConfigService: CryptoConfigService;
  private weatherConfigService: WeatherConfigService;
  private killSwitchMonitor: KillSwitchMonitor;
  private pnlPublisher: PnlTickPublisher;
  private marketTickPublisher: MarketTickPublisher;
  private exitEvaluator: PositionExitEvaluator;
  private lastMarketFetch = new Map<string, number>();
  private evaluating = false;
  private rerunRequested = false;
  private lastStrategyMetricsPushAt = 0;
  private onCycleComplete?: (snapshot: {
    durationMs: number;
    positionsEvaluated: number;
    positionsOpen: number;
    positionsOpenByMode: Record<string, number>;
    positionsByStatus: Record<string, number>;
    illiquidPositions: number;
    spreadMean: number;
  }) => void;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly closeQueue: RedisQueue<OrderSignal>,
    onCycleComplete?: StrategyProcessing['onCycleComplete'],
  ) {
    this.onCycleComplete = onCycleComplete;
    this.positionService = new CopiedPositionService(ds);
    this.marketService = new MarketService(ds);
    this.globalConfigService = new GlobalConfigService(ds);
    this.copyConfigService = new CopyConfigService(ds);
    this.cryptoConfigService = new CryptoConfigService(ds);
    this.weatherConfigService = new WeatherConfigService(ds);
    this.killSwitchMonitor = new KillSwitchMonitor(
      ds,
      connectionManager,
      closeQueue,
      this.copyConfigService,
      this.cryptoConfigService,
      this.weatherConfigService,
    );
    this.pnlPublisher = new PnlTickPublisher(
      this.positionService,
      connectionManager,
    );
    this.marketTickPublisher = new MarketTickPublisher(connectionManager);
    const executionService = new ExecutionService(ds);
    const mosResolver: MosResolver = async (pos) => {
      const lookup = pos.mode === 'real' ? await loadRealClobMarketInfoLookup() : undefined;
      return minSellQuantityViolation(
        { side: 'SELL', quantity: pos.quantity, conditionId: pos.conditionId, assetId: pos.assetId },
        lookup,
      );
    };
    this.exitEvaluator = new PositionExitEvaluator(
      closeQueue,
      (positionId) => executionService.hasInFlightBuy(positionId),
      mosResolver,
      (positionId, blockReason, closeReason, markBid) =>
        this.positionService.recordExitEmitBlock(positionId, {
          blockReason,
          closeReason,
          markBid,
        }),
      (positionId) => this.positionService.clearExitEmitBlock(positionId),
      (positionId, blockReason, closeReason, ageMs) => {
        notifyBackendAlert(
          'warning',
          `Exit emit blocked #${positionId}: ${closeReason} / ${blockReason} for ${Math.round(ageMs / 1000)}s`,
        );
        return Promise.resolve();
      },
    );
  }

  async evaluateKillSwitch(): Promise<void> {
    await this.killSwitchMonitor.evaluate();
  }

  clearExitState(positionId: number): void {
    this.exitEvaluator.clearPositionState(positionId);
  }

  async evaluateAll(): Promise<void> {
    if (this.evaluating) {
      this.rerunRequested = true;
      return;
    }
    this.evaluating = true;
    try {
      await this.runEvaluateAll();
    } catch (err) {
      log.error({ err }, 'strategy evaluateAll failed');
    } finally {
      this.evaluating = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.evaluateAll();
      }
    }
  }

  private async runEvaluateAll(): Promise<void> {
    const now = Date.now();
    if (
      this.killSwitchMonitor.shouldCheck(now, KILL_SWITCH_CHECK_INTERVAL_MS)
    ) {
      await this.killSwitchMonitor.evaluate();
    }

    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: { status: In([...OPEN_LIKE_POSITION_STATUSES]) },
    });

    // Always push a cycle snapshot (including zeros) so gauges and freshness
    // do not stay stale after the last open-like position closes.
    if (positions.length === 0) {
      this.emitStrategyCycleMetrics([], Date.now() - now);
      return;
    }

    const conditionIds = [...new Set(positions.map((p) => p.conditionId))];
    const [global, copy, crypto, weather] = await Promise.all([
      this.globalConfigService.getConfig(),
      this.copyConfigService.getConfig(),
      this.cryptoConfigService.getConfig(),
      this.weatherConfigService.getConfig(),
    ]);
    const markets = await this.refreshMarketsNearEnd(conditionIds, global, copy, crypto, weather);

    const ticks: PnlTick[] = [];
    const marketTicks: MarketTick[] = [];
    const seenAssets = new Set<string>();

    for (const pos of positions) {
      const algoKind = getAlgoKindForPosition(pos);
      let algoConfig: any;
      if (algoKind === 'copy') algoConfig = copy;
      else if (algoKind === 'crypto') algoConfig = crypto;
      else algoConfig = weather;

      const tick = await this.evaluatePosition(
        pos,
        markets.get(pos.conditionId),
        global,
        algoConfig,
      );
      if (tick) ticks.push(tick);

      if (!seenAssets.has(pos.assetId)) {
        seenAssets.add(pos.assetId);
        if (this.marketTickPublisher.shouldEmitTick(pos.assetId, now)) {
          const marketTick = this.marketTickPublisher.buildTick(
            pos.assetId,
            pos.quantity,
            pos.conditionId,
          );
          if (marketTick) {
            marketTicks.push(marketTick);
            this.marketTickPublisher.markTickEmitted(pos.assetId, now);
          }
        }
      }
    }

    await this.pnlPublisher.pushTicks(ticks);
    await this.marketTickPublisher.pushTicks(marketTicks);

    this.emitStrategyCycleMetrics(positions, Date.now() - now);
  }

  private emitStrategyCycleMetrics(
    positions: Parameters<typeof buildStrategyCycleMetricsSnapshot>[0],
    durationMs: number,
  ): void {
    if (!this.onCycleComplete) return;
    const now = Date.now();
    if (now - this.lastStrategyMetricsPushAt < STRATEGY_METRICS_PUSH_MIN_INTERVAL_MS) {
      return;
    }
    this.lastStrategyMetricsPushAt = now;
    this.onCycleComplete(buildStrategyCycleMetricsSnapshot(positions, durationMs));
  }

  private async refreshMarketsNearEnd(
    conditionIds: string[],
    globalConfig: GlobalConfig,
    copyConfig: CopyConfig,
    cryptoConfig: CryptoConfig,
    weatherConfig: WeatherConfig,
  ): Promise<Map<string, Market>> {
    const markets = await this.marketService.loadByConditionIds(conditionIds);
    const weatherAgg = resolveWeatherPreCloseAggregate(weatherConfig);
    const preCloseSource = {
      simPreCloseEnabled: copyConfig.simPreCloseEnabled || cryptoConfig.cryptoAlgoPreCloseEnabled === true || weatherAgg.enabled,
      realPreCloseEnabled: copyConfig.realPreCloseEnabled || cryptoConfig.cryptoAlgoPreCloseEnabled === true || weatherAgg.enabled,
      simPreCloseSeconds: Math.max(
        copyConfig.simPreCloseSeconds ?? 0,
        cryptoConfig.cryptoAlgoPreCloseSeconds ?? 0,
        weatherAgg.enabled ? weatherAgg.seconds : 0,
      ),
      realPreCloseSeconds: Math.max(
        copyConfig.realPreCloseSeconds ?? 0,
        cryptoConfig.cryptoAlgoPreCloseSeconds ?? 0,
        weatherAgg.enabled ? weatherAgg.seconds : 0,
      ),
      cryptoAlgoPreCloseEnabled: cryptoConfig.cryptoAlgoPreCloseEnabled,
      cryptoAlgoPreCloseSeconds: cryptoConfig.cryptoAlgoPreCloseSeconds,
    };
    if (!isAnyPreCloseEnabled(preCloseSource)) return markets;

    const maxPreCloseSeconds = getMaxPreCloseSeconds(preCloseSource);

    const now = Date.now();
    let refreshed = false;

    for (const conditionId of conditionIds) {
      const market = markets.get(conditionId);
      if (!market?.endDate) continue;

      const timeToEndMs = market.endDate.getTime() - now;
      if (
        !isPreCloseMonitoringScope({
          preCloseEnabled: true,
          preCloseSeconds: maxPreCloseSeconds,
          timeToEndMs,
        })
      ) {
        continue;
      }

      const lastFetch = this.lastMarketFetch.get(conditionId) ?? 0;
      if (now - lastFetch < MARKET_REFRESH_THROTTLE_MS) continue;

      this.lastMarketFetch.set(conditionId, now);
      await this.marketService.fetchAndPersist(conditionId);
      refreshed = true;
    }

    if (!refreshed) return markets;
    return this.marketService.loadByConditionIds(conditionIds);
  }

  private async evaluatePosition(
    pos: CopiedPosition,
    market: Market | undefined,
    globalConfig: GlobalConfig,
    algoConfig: any,
  ): Promise<PnlTick | null> {
    const { lifecycle, settled } = resolveMarkState(pos, market);

    const fetched = await this.connectionManager.fetchSellExecutablePricesWithDepth(
      pos.assetId,
      pos.quantity,
      config.marketTickRefQty,
    );

    // Open positions still attempt a live fetch on terminal markets so a
    // residual CLOB bid is not discarded before SL/TP evaluation.
    const bookPrices =
      fetched.executableBidVwap > 0 || pos.status === 'open'
        ? fetched
        : lifecycle && isMarketTerminal(lifecycle)
          ? {
            executableBidVwap: 0,
            executableAskVwap: 0,
            liquidityStatus: 'illiquid' as LiquidityStatus,
            sizedBestBid: 0,
          }
          : fetched;

    const wsBook = this.connectionManager.getOrderBook(pos.assetId);
    const wsBestBid = wsBook
      ? computeTopOfBook(wsBook)?.bestBid
      : undefined;
    const sizedBestBid =
      'sizedBestBid' in bookPrices ? (bookPrices.sizedBestBid ?? 0) : 0;
    const markBid = resolveMarkBidForExit(pos, bookPrices.executableBidVwap, {
      wsBestBid,
      lifecycle,
    });
    const bookLiquid = bookPrices.executableBidVwap > 0;
    const liquidityStatus = bookLiquid
      ? bookPrices.liquidityStatus
      : 'illiquid';
    const now = Date.now();
    const marketInterval = resolveMarketInterval(market ?? null);
    const liveCloseableBid = resolveLiveCloseableBid(
      bookPrices.executableBidVwap,
      wsBestBid,
      sizedBestBid > 0 ? sizedBestBid : undefined,
    );
    if (liveCloseableBid > 0) {
      await this.positionService.updateLastCloseableBid(
        pos.id,
        liveCloseableBid,
        new Date(now),
      );
      pos.lastCloseableBidVwap = liveCloseableBid;
      pos.lastCloseableBidAt = new Date(now);
    }

    const metrics = this.connectionManager.getMetricsCache().get(pos.assetId);
    const lastTradePrice = metrics?.lastTradePrice;
    const lastTradeTimestamp = metrics?.lastTradeTimestamp
      ? new Date(metrics.lastTradeTimestamp)
      : null;
    const bookUpdatedAt = wsBook?.updatedAt ?? null;
    if (!bookLiquid) {
      return evaluateIlliquidPosition({
        pos,
        market,
        globalConfig,
        algoConfig,
        connectionManager: this.connectionManager,
        positionService: this.positionService,
        pnlPublisher: this.pnlPublisher,
        exitEvaluator: this.exitEvaluator,
        bookPrices: { ...bookPrices, sizedBestBid },
        wsBestBid,
        settled,
        now,
        markBid,
        marketInterval,
        lastTradePrice,
        bookUpdatedAt,
        lastTradeTimestamp,
      });
    }
    return evaluateLiquidPosition({
      pos,
      market,
      globalConfig,
      algoConfig,
      pnlPublisher: this.pnlPublisher,
      exitEvaluator: this.exitEvaluator,
      bookPrices: { ...bookPrices, sizedBestBid },
      wsBestBid,
      settled,
      lifecycle,
      now,
      marketInterval,
      lastTradePrice,
      bookUpdatedAt,
      lastTradeTimestamp,
    });
  }

  startEvaluation(intervalMs = STRATEGY_EVAL_INTERVAL_MS): NodeJS.Timeout {
    return safeInterval(() => this.evaluateAll(), intervalMs, 'strategy-evaluation');
  }
}
