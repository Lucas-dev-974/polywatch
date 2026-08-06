import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import pino from 'pino';
import {
  safeInterval,
  getCryptoAlgoStrategies,
  fetchGammaMarket,
  resolveCryptoAlgoReentryParams,
  resolveNaiveMomentumConfig,
  resolveGammaCacheTtlMs,
  resolveGammaStaleOnErrorFactor,
  tryLoadCryptoReentryState,
  isCryptoReentrySuppressed,
  recordCryptoReentryFill,
  type MarketService,
  type CryptoConfigService,
  type CryptoConfig,
  type Market,
  type MarketListItemDto,
  type AlgoMarketSelectionService,
  type GammaMarket,
  type IPolymarketConnectionManager,
  type TradingMode,
  buildPolymarketMarketUrl,
  extractStartDateFromQuestion,
  isTradableAlgoMarket,
  MarketType,
  parseMarketOutcomes,
} from '@polywatch/core';
import type { SelectionLoader } from '../selection-loader.js';
import type {
  AlgoSignal,
  AbstainReasonCode,
  CryptoAlgoStrategy,
  StrategyContext,
  StrategyRegistry,
} from './index.js';
import { isConfigurableStrategy } from './strategy.js';
import { CryptoAlgoPriceFeed } from '../price-feed.js';
import type { CryptoAlgoRuntimeStatusPublisher } from '../runtime-status.js';
import {
  type ReEntryState,
  buildReEntryKey,
  cleanupReentryMap,
  normalizeReEntryOutcome,
  recordReEntrySuccess,
  shouldSuppressReEntry,
} from './re-entry-throttle.js';
import { normalizeInterval } from './constants.js';
import { cleanupGlobalSlQuotaCache, invalidateGlobalSlQuotaCache } from './sl-quota.js';

const log = pino({ name: 'crypto-algo:strategy-runner' });

/**
 * Re-entry window length in ms when interval and risk config do not override.
 * @deprecated Prefer {@link resolveCryptoAlgoReentryParams} via risk config.
 */
export const RE_ENTRY_WINDOW_MS = 60 * 60 * 1000;

/**
 * Maximum number of successful enqueues per re-entry window per outcome.
 * @deprecated Prefer {@link resolveCryptoAlgoReentryParams} via risk config.
 */
export const MAX_ENTRIES_PER_WINDOW = 1;

/**
 * Default Gamma cache TTL for longer intervals (1h+).
 * @deprecated Prefer {@link resolveGammaCacheTtlMs} via risk config.
 */
const OUTCOME_PRICES_CACHE_TTL_DEFAULT_MS = 30_000;

/**
 * Gamma cache TTL for short intervals (≤15m).
 * @deprecated Prefer {@link resolveGammaCacheTtlMs} via risk config.
 */
const OUTCOME_PRICES_CACHE_TTL_SHORT_MS = 10_000;

/** Stale-on-error may serve cache up to this multiple of the TTL. */
const GAMMA_STALE_ON_ERROR_TTL_FACTOR = 2;

/**
 * Maximum number of entries to keep in the Gamma cache.
 * Prevents memory leak from accumulating stale market data.
 */
const MAX_GAMMA_CACHE_SIZE = 100;

/**
 * How often to clean up expired cache entries (5 minutes).
 */
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * Polling interval fallback when WebSocket is not connected.
 * Used as safety net in case WS events are missed.
 */
const DEFAULT_POLL_MS = 30_000;

interface CachedGammaMarket {
  market: GammaMarket;
  fetchedAt: number;
}

/**
 * Drives the crypto-algo strategy evaluation loop.
 *
 * Two evaluation modes:
 *   1. **WebSocket-triggered**: Price updates from WebSocket trigger immediate
 *      strategy evaluation with fresh top-of-book data.
 *   2. **Polling fallback**: Periodic polling (30s default) as safety net when
 *      WebSocket is disconnected or events are missed.
 *
 * On each evaluation:
 *   1. Reads the kill-switch (`CryptoConfig.cryptoAlgoEnabled`).
 *   2. Resolves the enabled strategy ids and the active strategies.
 *   3. Fetches live outcome prices from Gamma API.
 *   4. Enriches context with WebSocket top-of-book data if available.
 *   5. Runs each active strategy against the market; the first non-null
 *      `AlgoSignal` wins and is forwarded to the entry pipeline.
 *
 * Re-entry throttling prevents spam: max N confirmed fills per
 * conditionId:outcome per window (configurable via risk config).
 */
export class StrategyRunner {
  private readonly reentry = new Map<string, ReEntryState>();
  private readonly gammaCache = new Map<string, CachedGammaMarket>();
  /** Serializes evaluateSelection per conditionId (WS + polling race). */
  private readonly evalChains = new Map<string, Promise<boolean>>();
  private tickTimer: NodeJS.Timeout | null = null;
  private janitorTimer: NodeJS.Timeout | null = null;
  private priceFeed: CryptoAlgoPriceFeed | null = null;
  /** Redis SoT for re-entry throttle (optional in unit tests). */
  private redis: Redis | null = null;
  private wsConnected = false;
  private pollMs = DEFAULT_POLL_MS;
  private currentCryptoConfig: CryptoConfig | null = null;
  private onSelectionResolved?: (conditionId: string) => Promise<void>;
  private onAbstain?: (
    conditionId: string,
    reason: AbstainReasonCode,
    detail?: string,
  ) => void;

  constructor(
    private readonly selectionLoader: SelectionLoader,
    private readonly registry: StrategyRegistry,
    private readonly cryptoConfigService: CryptoConfigService,
    private readonly marketService: MarketService,
    private readonly dataSource: DataSource,
    private readonly algoSelectionService: AlgoMarketSelectionService,
    private readonly onSignal: (signal: AlgoSignal) => Promise<boolean>,
    private readonly gammaApi: string,
    private readonly reEntryWindowMs: number = RE_ENTRY_WINDOW_MS,
    private readonly runtimeStatus?: CryptoAlgoRuntimeStatusPublisher,
  ) {}

  /** Expose WebSocket connectivity for runtime status reporting. */
  isWsConnected(): boolean {
    return this.wsConnected;
  }

  /** Optional hook to persist abstain reasons (e.g. into price ticks). */
  setOnAbstain(
    cb: (conditionId: string, reason: AbstainReasonCode, detail?: string) => void,
  ): void {
    this.onAbstain = cb;
  }

  /**
   * Set up WebSocket price feed for real-time strategy evaluation.
   * Must be called before start() to enable WebSocket-triggered evaluation.
   */
  setPriceFeed(priceFeed: CryptoAlgoPriceFeed): void {
    this.priceFeed = priceFeed;

    // Register callback for price updates (trigger only — books re-resolved below)
    priceFeed.setOnPriceUpdate((conditionId, assetId) => {
      this.handlePriceUpdate(conditionId, assetId);
    });

    // Register callback for market resolved events
    priceFeed.setOnMarketResolved((conditionId) => {
      void this.handleMarketResolved(conditionId);
    });
  }

  /** Wire Redis for durable re-entry throttle (required in production). */
  setRedis(redis: Redis): void {
    this.redis = redis;
  }

  /**
   * Called after a selection is disabled due to a WebSocket market_resolved event.
   * Use this to trigger immediate auto-track discovery and frontend refresh.
   */
  setOnSelectionResolved(
    cb: (conditionId: string) => Promise<void>,
  ): void {
    this.onSelectionResolved = cb;
  }

  /**
   * Connect to WebSocket and subscribe to active markets.
   */
  async connectWebSocket(
    connectionManager: IPolymarketConnectionManager,
    conditionIds: string[],
  ): Promise<void> {
    if (!this.priceFeed) {
      log.warn('price feed not set — cannot connect WebSocket');
      return;
    }

    this.priceFeed.setConnectionManager(connectionManager);
    await this.priceFeed.connect();
    await this.priceFeed.subscribeToMarkets(conditionIds, this.marketService);
    this.wsConnected = true;

    log.info({ count: conditionIds.length }, 'WebSocket connected and subscribed to markets');
  }

  /**
   * Update WebSocket subscriptions when active selections change.
   */
  updateWebSocketSubscriptions(conditionIds: string[]): void {
    if (!this.priceFeed || !this.wsConnected) return;

    this.priceFeed.unsubscribeStale(conditionIds);
    // Note: subscribeToMarkets is async but we don't await here
    // to avoid blocking the config-changed handler
    void this.priceFeed.subscribeToMarkets(conditionIds, this.marketService);
  }

  /**
   * Start the evaluation loop at `pollMs` cadence (fallback mode).
   * Also starts the janitor for resolved markets.
   */
  start(pollMs: number = DEFAULT_POLL_MS): NodeJS.Timeout {
    this.pollMs = pollMs;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.tickTimer = safeInterval(
      () => this.tick(),
      pollMs,
      'strategy-runner:tick',
    );

    log.info({ pollMs, wsConnected: this.wsConnected }, 'strategy runner started');
    return this.tickTimer;
  }

  /** Drop cached SL quota for a market/mode (e.g. after SL close pub/sub). */
  invalidateSlQuotaCache(conditionId: string, mode?: TradingMode): void {
    invalidateGlobalSlQuotaCache(conditionId, mode);
  }

  /**
   * Consume a re-entry slot after a confirmed algo BUY fill.
   * Called via Redis pub/sub when the worker finalizes an ALGO_OPEN execution.
   * Redis is the source of truth; the in-memory Map is a test/fallback cache.
   */
  recordReEntryOnFill(
    conditionId: string,
    outcome: string,
    nowMs = Date.now(),
    positionId?: number,
    windowMsOverride?: number,
  ): void {
    if (this.reEntryWindowMs === 0) return;

    const normalized = normalizeReEntryOutcome(outcome);
    if (!normalized) {
      log.warn({ conditionId, outcome }, 'ignored re-entry fill — unknown outcome');
      return;
    }

    const cryptoConfig = this.currentCryptoConfig;
    if (!cryptoConfig) {
      log.warn({ conditionId }, 'ignored re-entry fill — crypto config not loaded');
      return;
    }

    const selection = this.selectionLoader
      .getActiveSelections()
      .find((s) => s.conditionId === conditionId);
    const reentryParams = resolveCryptoAlgoReentryParams(cryptoConfig, selection?.interval);
    const windowMs = windowMsOverride && windowMsOverride > 0
      ? windowMsOverride
      : reentryParams.windowMs;
    const reEntryKey = buildReEntryKey(conditionId, normalized);

    // Local cache (tests / brief lag before next Redis read).
    recordReEntrySuccess(this.reentry, reEntryKey, nowMs, windowMs);

    if (this.redis && positionId != null && positionId > 0) {
      void recordCryptoReentryFill(this.redis, {
        conditionId,
        outcome: normalized,
        positionId,
        windowMs,
        nowMs,
      }).catch((err) => {
        log.warn(
          { err, conditionId, outcome: normalized, positionId },
          'failed to mirror re-entry fill into Redis',
        );
      });
    }

    log.info(
      { conditionId, outcome: normalized, windowMs, positionId },
      're-entry slot consumed after fill',
    );
  }

  /** Reconfigure poll interval (e.g. on config-changed). */
  reconfigurePollMs(pollMs: number): void {
    if (pollMs === this.pollMs && this.tickTimer) return;
    this.start(pollMs);
  }

  /** Apply risk tunables to all configurable strategies (registry-driven). */
  applyRiskTunables(cryptoConfig: CryptoConfig): void {
    this.currentCryptoConfig = cryptoConfig;
    for (const strategy of this.registry.getAllStrategies()) {
      if (isConfigurableStrategy(strategy)) {
        strategy.applyTunables(cryptoConfig);
      }
    }
  }

  /** Stop the evaluation loop. */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.priceFeed) {
      this.priceFeed.disconnect();
      this.wsConnected = false;
    }
  }

  /**
   * Clean up expired Gamma cache entries and stale re-entry throttle state.
   * Called from the unified market janitor in `index.ts`.
   */
  runMaintenanceCleanup(): void {
    this.cleanupGammaCache();
    this.cleanupReentryState();
    this.cleanupSlQuotaState();
  }

  /**
   * Start a periodic maintenance timer (cache + re-entry cleanup only).
   * Market resolution and auto-track discovery run in the unified market
   * janitor in `index.ts`.
   */
  startJanitor(): NodeJS.Timeout {
    if (this.janitorTimer) return this.janitorTimer;

    this.janitorTimer = safeInterval(
      async () => {
        this.runMaintenanceCleanup();
      },
      60_000,
      'strategy-runner:maintenance',
    );

    return this.janitorTimer;
  }

  /** Stop the janitor interval. */
  stopJanitor(): void {
    if (this.janitorTimer) {
      clearInterval(this.janitorTimer);
      this.janitorTimer = null;
    }
  }

  /**
   * Fetch Gamma market data with caching. Returns cached data if still fresh,
   * otherwise fetches from Gamma API.
   * Also enforces cache size limits to prevent memory leaks.
   */
  private async fetchGammaMarketCached(
    conditionId: string,
    now: number,
    interval?: string | null,
    cryptoConfig?: CryptoConfig,
  ): Promise<GammaMarket | null> {
    const effectiveCfg = cryptoConfig ?? this.currentCryptoConfig;
    const ttlMs = effectiveCfg
      ? resolveGammaCacheTtlMs(effectiveCfg, interval)
      : gammaCacheTtlFallback(interval);
    const staleFactor = effectiveCfg
      ? resolveGammaStaleOnErrorFactor(effectiveCfg)
      : GAMMA_STALE_ON_ERROR_TTL_FACTOR;
    const cached = this.gammaCache.get(conditionId);
    if (cached && now - cached.fetchedAt < ttlMs) {
      return cached.market;
    }

    try {
      const market = await fetchGammaMarket(conditionId);
      if (!market) return null;

      // Enforce cache size limit - remove oldest entries if over limit
      if (this.gammaCache.size >= MAX_GAMMA_CACHE_SIZE) {
        this.cleanupGammaCache();
      }

      this.gammaCache.set(conditionId, { market, fetchedAt: now });
      return market;
    } catch (err) {
      log.warn({ err, conditionId }, 'failed to fetch Gamma market data');
      // Serve stale only within 2× TTL; beyond that treat as missing.
      if (
        cached &&
        now - cached.fetchedAt <= ttlMs * staleFactor
      ) {
        return cached.market;
      }
      return null;
    }
  }

  /**
   * Remove expired entries from the Gamma cache.
   */
  private cleanupGammaCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const entry of Array.from(this.gammaCache.entries())) {
      // Use the longer default TTL so short-interval entries are not kept forever.
      if (now - entry[1].fetchedAt > OUTCOME_PRICES_CACHE_TTL_DEFAULT_MS) {
        this.gammaCache.delete(entry[0]);
        removed++;
      }
    }

    // If still over limit, remove oldest entries
    if (this.gammaCache.size >= MAX_GAMMA_CACHE_SIZE) {
      const entries = Array.from(this.gammaCache.entries())
        .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);

      const toRemove = entries.slice(0, entries.length - MAX_GAMMA_CACHE_SIZE);
      for (const entry of toRemove) {
        this.gammaCache.delete(entry[0]);
        removed++;
      }
    }

    if (removed > 0) {
      log.debug({ removed, remaining: this.gammaCache.size }, 'cleaned up Gamma cache');
    }
  }

  /**
   * Clean up re-entry windows that have expired.
   */
  private cleanupReentryState(): void {
    const removed = cleanupReentryMap(this.reentry, Date.now());
    if (removed > 0) {
      log.debug({ removed, remaining: this.reentry.size }, 'cleaned up re-entry state');
    }
  }

  /** Remove expired entries from the SL quota cache. */
  private cleanupSlQuotaState(): void {
    const nowMs = Date.now();
    const maxAgeMs = 600_000; // 10 min max cache lifetime
    const removed = cleanupGlobalSlQuotaCache(nowMs, maxAgeMs);
    if (removed > 0) {
      log.debug({ removed }, 'cleaned up SL quota cache');
    }
  }

  /**
   * Handle price update from WebSocket - trigger immediate strategy evaluation.
   * The assetId is a trigger only; books are always re-resolved for both outcomes.
   */
  private async handlePriceUpdate(
    conditionId: string,
    assetId: string,
  ): Promise<void> {
    log.debug(
      { conditionId, assetId },
      'price update received from WebSocket',
    );

    // Get the selection for this conditionId
    const selections = this.selectionLoader.getActiveSelections();
    const selection = selections.find(s => s.conditionId === conditionId);
    if (!selection || !selection.enabled) return;

    // Evaluate strategies for this specific market
    await this.evaluateSelection(selection);
  }

  /**
   * Handle market resolved event from WebSocket.
   * Immediately disable the selection to prevent further signals.
   */
  private async handleMarketResolved(conditionId: string): Promise<void> {
    log.info({ conditionId }, 'market resolved event — disabling selection immediately');

    try {
      // Disable the selection immediately (don't wait for janitor)
      await this.algoSelectionService.setEnabled(conditionId, false);
      log.info({ conditionId }, 'selection disabled after market resolved');

      // Clear price-feed cache for this condition
      this.priceFeed?.clearTopOfBook(conditionId);
      // Purge any settled eval-chain entry for this market (no-op while an
      // evaluation is in flight — it completes normally).
      this.evalChains.delete(conditionId);
      log.debug({ conditionId }, 'cleared price-feed cache for resolved market');

      if (this.onSelectionResolved) {
        await this.onSelectionResolved(conditionId);
      }
    } catch (err) {
      log.error({ err, conditionId }, 'failed to disable selection after market resolved');
    }
  }

  /**
   * Evaluate strategies for a single selection with both outcome books from WS.
   * Serialized per conditionId so WS debounce and polling cannot double-fire.
   */
  private evaluateSelection(
    selection: { conditionId: string; enabled: boolean; question?: string | null; cryptoSymbol?: string | null; interval?: string | null; slug?: string | null },
  ): Promise<boolean> {
    const conditionId = selection.conditionId;
    const existing = this.evalChains.get(conditionId);
    if (existing) {
      // Coalesce: an evaluation is already queued/running for this market.
      // Drop this trigger — it carried stale data by the time it would run,
      // and the next WS update / poll tick re-evaluates with fresh data.
      return existing;
    }
    const next = this.evaluateSelectionUnlocked(selection);
    const tracked = next.then(
      () => false,
      () => false,
    );
    this.evalChains.set(conditionId, tracked);
    // Purge the entry once settled: short-lived 5m/15m markets rotate
    // constantly and would otherwise grow the map without bound.
    void tracked.then(() => {
      if (this.evalChains.get(conditionId) === tracked) {
        this.evalChains.delete(conditionId);
      }
    });
    return next;
  }

  private async evaluateSelectionUnlocked(
    selection: { conditionId: string; enabled: boolean; question?: string | null; cryptoSymbol?: string | null; interval?: string | null; slug?: string | null },
  ): Promise<boolean> {
    let cryptoConfig: CryptoConfig;
    try {
      cryptoConfig = await this.cryptoConfigService.getConfig();
    } catch (err) {
      log.error({ err }, 'failed to load crypto config — skipping evaluation');
      this.runtimeStatus?.recordSkip('échec chargement config risque', selection.conditionId);
      return false;
    }

    if (!cryptoConfig.cryptoAlgoEnabled) {
      this.runtimeStatus?.recordSkip('algo désactivé dans la config', selection.conditionId);
      return false;
    }

    this.applyRiskTunables(cryptoConfig);

    const enabledIds = getCryptoAlgoStrategies(cryptoConfig);
    if (enabledIds.length === 0) {
      this.runtimeStatus?.recordSkip('aucune stratégie activée', selection.conditionId);
      return false;
    }

    const strategies = this.registry.getActiveStrategies(enabledIds);
    if (strategies.length === 0) {
      this.runtimeStatus?.recordSkip('stratégies introuvables', selection.conditionId);
      return false;
    }

    const market = await this.resolveMarketForSelection(selection.conditionId);
    if (!market) {
      log.warn(
        { conditionId: selection.conditionId },
        'no market row after ensureTradableMarket — skipping evaluation',
      );
      this.runtimeStatus?.recordSkip('marché introuvable', selection.conditionId);
      return false;
    }

    const now = new Date();

    if (market.endDate && market.endDate < now) {
      this.runtimeStatus?.recordSkip('marché expiré', selection.conditionId);
      return false;
    }
    if (market.acceptingOrders === false) {
      this.runtimeStatus?.recordSkip('ordres non acceptés', selection.conditionId);
      return false;
    }
    if (market.resolved || market.closed) {
      this.runtimeStatus?.recordSkip('marché résolu ou fermé', selection.conditionId);
      return false;
    }

    // Fetch Gamma market for outcome prices
    let gammaMarket: GammaMarket | null = null;
    try {
      gammaMarket = await this.fetchGammaMarketCached(
        selection.conditionId,
        now.getTime(),
        selection.interval,
        cryptoConfig,
      );
    } catch (err) {
      log.warn({ err, conditionId: selection.conditionId }, 'failed to fetch Gamma market');
    }

    const books = this.priceFeed?.getOutcomeBooks(selection.conditionId);
    const tunables = resolveNaiveMomentumConfig(cryptoConfig);
    const midHistory = tunables.curveFilterEnabled
      ? this.priceFeed?.getOutcomeMidHistory(
          selection.conditionId,
          tunables.curveLookbackMs,
          now.getTime(),
        )
      : undefined;
    const endMs = market.endDate ? new Date(market.endDate).getTime() : NaN;
    const secondsUntilEnd = Number.isFinite(endMs)
      ? Math.max(0, Math.floor((endMs - now.getTime()) / 1000))
      : null;
    const ctx: StrategyContext = {
      now,
      books: books
        ? { up: books.up, down: books.down }
        : undefined,
      midHistory: midHistory ?? undefined,
      secondsUntilEnd,
      spotData: null,
    };

    // Build DTO and context
    const dto = this.marketToListItemDto(market, selection, gammaMarket);

    // Evaluate strategies
    let fired: AlgoSignal | null = null;
    let firedStrategy: CryptoAlgoStrategy | null = null;
    let lastAbstain: { reason: AbstainReasonCode; detail?: string } | null = null;

    for (const strategy of strategies) {
      try {
        const result = await strategy.evaluate(dto, ctx);
        if (result.kind === 'signal') {
          fired = result.signal;
          firedStrategy = strategy;
          break;
        }
        lastAbstain = { reason: result.reason, detail: result.detail };
      } catch (err) {
        log.error(
          { err, strategyId: strategy.id, conditionId: selection.conditionId },
          'strategy.evaluate threw — continuing',
        );
      }
    }

    if (!fired || !firedStrategy) {
      const yesPrice = this.extractYesPrice(dto);
      const abstainLabel = lastAbstain
        ? lastAbstain.detail
          ? `${lastAbstain.reason} (${lastAbstain.detail})`
          : lastAbstain.reason
        : 'unknown';
      log.info(
        {
          conditionId: selection.conditionId,
          yesPrice,
          abstainReason: lastAbstain?.reason ?? null,
          abstainDetail: lastAbstain?.detail ?? null,
          upSpread: books?.up?.spread ?? null,
          downSpread: books?.down?.spread ?? null,
        },
        'all strategies abstained',
      );
      this.runtimeStatus?.recordSkip(
        `stratégies en abstention (${abstainLabel})`,
        selection.conditionId,
      );
      if (lastAbstain) {
        this.onAbstain?.(
          selection.conditionId,
          lastAbstain.reason,
          lastAbstain.detail,
        );
      }
      return true;
    }

    // Re-entry throttling (bypass when ctor reEntryWindowMs === 0, e2e only)
    const nowMs = now.getTime();
    const reEntryKey = buildReEntryKey(selection.conditionId, fired.outcome);
    const throttleDisabled = this.reEntryWindowMs === 0;

    if (!throttleDisabled) {
      const reentryParams = resolveCryptoAlgoReentryParams(cryptoConfig, selection.interval);
      let suppressed = false;
      let suppressCount: number | undefined;

      if (this.redis) {
        const loaded = await tryLoadCryptoReentryState(
          this.redis,
          selection.conditionId,
          fired.outcome,
        );
        if (!loaded.ok) {
          // Fail-closed: Redis down must not allow revenge re-entry after restart.
          log.warn(
            { err: loaded.error, conditionId: selection.conditionId, outcome: fired.outcome },
            're-entry Redis unavailable — suppressing entry (fail-closed)',
          );
          this.runtimeStatus?.recordSkip(
            'ré-entrée indisponible (Redis)',
            selection.conditionId,
          );
          this.onAbstain?.(selection.conditionId, 're_entry_limit');
          return true;
        }
        suppressed = isCryptoReentrySuppressed(
          loaded.state,
          nowMs,
          reentryParams.maxEntries,
        );
        suppressCount = loaded.state?.count;
      } else {
        const state = this.reentry.get(reEntryKey);
        suppressed = shouldSuppressReEntry(state, nowMs, reentryParams.maxEntries);
        suppressCount = state?.count;
      }

      if (suppressed) {
        log.info(
          {
            conditionId: selection.conditionId,
            outcome: fired.outcome,
            strategyId: firedStrategy.id,
            count: suppressCount,
            max: reentryParams.maxEntries,
          },
          're-entry limit reached — suppressing signal',
        );
        this.runtimeStatus?.recordSkip('limite de ré-entrée atteinte', selection.conditionId);
        this.onAbstain?.(selection.conditionId, 're_entry_limit');
        return true;
      }
    }

    // Fire the signal
    let accepted = false;
    try {
      accepted = await this.onSignal(fired);
    } catch (err) {
      log.error(
        { err, conditionId: selection.conditionId, strategyId: firedStrategy.id },
        'onSignal callback rejected — signal not counted',
      );
      this.runtimeStatus?.recordSkip('échec pipeline entrée', selection.conditionId);
      return true;
    }

    if (!accepted) {
      log.info(
        {
          conditionId: selection.conditionId,
          strategyId: firedStrategy.id,
          outcome: fired.outcome,
        },
        'entry pipeline skipped — signal not enqueued',
      );
      return true;
    }

    log.info(
      {
        conditionId: selection.conditionId,
        strategyId: firedStrategy.id,
        outcome: fired.outcome,
        confidence: fired.confidence,
        source: books?.up || books?.down ? 'websocket' : 'polling',
      },
      'signal forwarded to entry pipeline',
    );
    return true;
  }

  /** A single evaluation pass over all active selections (polling mode). */
  async tick(): Promise<void> {
    const selections = this.selectionLoader.getActiveSelections();
    const enabled = selections.filter((s) => s.enabled);

    if (enabled.length === 0) {
      log.info('no active algo market selections — skipping tick');
      await this.runtimeStatus?.publish({
        enabledSelections: 0,
        evaluableSelections: 0,
        wsConnected: this.wsConnected,
      });
      return;
    }

    let cryptoConfig: CryptoConfig;
    try {
      cryptoConfig = await this.cryptoConfigService.getConfig();
    } catch (err) {
      log.error({ err }, 'failed to load crypto config — skipping tick');
      await this.runtimeStatus?.publish({
        enabledSelections: enabled.length,
        evaluableSelections: 0,
        wsConnected: this.wsConnected,
      });
      return;
    }

    if (!cryptoConfig.cryptoAlgoEnabled) {
      log.warn('crypto-algo kill-switch is off — skipping tick');
      this.runtimeStatus?.recordSkip('algo désactivé dans la config');
      await this.runtimeStatus?.publish({
        enabledSelections: enabled.length,
        evaluableSelections: 0,
        wsConnected: this.wsConnected,
      });
      return;
    }

    let evaluableSelections = 0;
    for (const selection of enabled) {
      const market = await this.marketService.ensureTradableMarket(selection.conditionId);
      if (market && isTradableAlgoMarket(market)) {
        evaluableSelections += 1;
      }
    }

    for (const selection of selections) {
      if (!selection.enabled) continue;
      await this.evaluateSelection(selection);
    }

    await this.runtimeStatus?.publish({
      enabledSelections: enabled.length,
      evaluableSelections,
      wsConnected: this.wsConnected,
    });
  }

  private async resolveMarketForSelection(
    conditionId: string,
  ): Promise<Market | undefined> {
    const market = await this.marketService.ensureTradableMarket(conditionId);
    return market ?? undefined;
  }

  private marketToListItemDto(
    market: Market,
    selection?: {
      question?: string | null;
      cryptoSymbol?: string | null;
      interval?: string | null;
      slug?: string | null;
    },
    gammaMarket?: GammaMarket | null,
  ): MarketListItemDto {
    const slug = market.slug ?? selection?.slug ?? null;
    const eventSlug = market.eventSlug ?? null;
    const question = market.question ?? selection?.question ?? gammaMarket?.question ?? null;
    return {
      conditionId: market.conditionId,
      question,
      slug,
      eventSlug,
      icon: market.icon,
      startDate:
        extractStartDateFromQuestion(question) ??
        (gammaMarket?.question
          ? extractStartDateFromQuestion(gammaMarket.question)
          : null),
      endDate: market.endDate ? market.endDate.toISOString() : gammaMarket?.endDate ?? null,
      volume: gammaMarket?.volume ?? null,
      volume24hr: gammaMarket?.volume24hr ?? null,
      liquidityClob: gammaMarket?.liquidityClob ?? null,
      outcomePrices: gammaMarket?.outcomePricesParsed ?? [],
      outcomes: gammaMarket?.outcomeTokens ?? parseMarketOutcomes(market.outcomes),
      acceptingOrders: market.acceptingOrders,
      closed: market.closed,
      url: buildPolymarketMarketUrl(eventSlug, slug, market.conditionId),
      tokenIdYes: market.tokenIdYes,
      tokenIdNo: market.tokenIdNo,
      category: market.category,
      tagSlugs: this.parseTagSlugs(market.tagSlugs),
      cryptoSymbol: selection?.cryptoSymbol ?? null,
      interval: selection?.interval ?? null,
      cryptoCategory: null,
      marketType: MarketType.CRYPTO_UP_DOWN,
    };
  }

  private extractYesPrice(dto: MarketListItemDto): number | null {
    const prices = dto.outcomePrices;
    if (!prices?.length) return null;
    const yes = prices.find((p) => {
      const label = p.outcome.toLowerCase();
      return label === 'yes' || label === 'up';
    });
    return yes?.price ?? null;
  }

  private parseTagSlugs(stored: string | null | undefined): string[] {
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
        return parsed;
      }
    } catch {
      /* fall through */
    }
    return [];
  }
}

function gammaCacheTtlFallback(interval: string | null | undefined): number {
  const normalized = interval ? normalizeInterval(interval) : null;
  if (
    normalized === '5m' ||
    normalized === '10m' ||
    normalized === '15m'
  ) {
    return OUTCOME_PRICES_CACHE_TTL_SHORT_MS;
  }
  return OUTCOME_PRICES_CACHE_TTL_DEFAULT_MS;
}