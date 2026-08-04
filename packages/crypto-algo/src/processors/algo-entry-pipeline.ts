import {
  computeEntryTargetQuantity,
  getCryptoMaxPositionSizeUsdc,
  getCryptoAlgoSizingParams,
  hashAlgoLogicalKey,
  hashAlgoOrderSignalId,
  enqueueEntrySignal,
  resolveEntryEnqueueBlocked,
  hasAlgoEntryCooldown,
  MIN_ORDER_SHARES,
  MIN_ORDER_USDC,
  MarketService,
  ReservationService,
  SimulationService,
  ExecutionService,
  resolveAlgoEntryExitParams,
  resolveCryptoAlgoMinTimeToClose,
  resolveMarketInterval,
  resolveEntryBalances,
  resumeEntryFromReservation,
  applyEntryMosGate,
  effectiveEntryMos,
  resolveEntryMinOrderSharesDetailed,
  fetchEntryAskLiquidityWithRetries,
  getCryptoEntryDepthRetryMax,
  getCryptoEntryDepthRetryDelayMs,
  gateAlgoEntryAskLiquidity,
  type AlgoEntryExitParams,
  type OrderSignal,
  type CryptoConfig,
  type TradingMode,
  type RedisQueue,
  type IPolymarketConnectionManager,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import pino from 'pino';
import type { AlgoSignal } from '../strategy/strategy.js';
import { fetchAvailableRealCash } from '../real-cash.js';
import { resolveSlQuotaEntryBlock } from '../strategy/sl-quota.js';

const log = pino({ name: 'crypto-algo:entry-pipeline' });

const CLOB_API = process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com';

/**
 * Pipeline parameters for {@link runAlgoEntryPipeline}.
 */
export interface AlgoEntryPipelineParams {
  signal: AlgoSignal;
  risk: CryptoConfig;
  watchlistId: number;
  connectionManager: IPolymarketConnectionManager;
  reservationService: ReservationService;
  simulationService: SimulationService;
  marketService: MarketService;
  orderQueue: RedisQueue<OrderSignal>;
  /** Redis command connection for entry cooldown checks. */
  redisCmd: Pick<Redis, 'exists'>;
  /** DataSource for reading GlobalConfig.realCashOverride. Required for real mode. */
  ds: DataSource;
  /** Whether real trading is enabled (from GlobalConfig). */
  realTradingEnabled: boolean;
  /** Backend URL for fetching on-chain balance. Required for real mode. */
  backendUrl: string;
  /** Service token for backend auth. Required for real mode. */
  serviceToken: string;
}

/**
 * Run the crypto-algo entry pipeline for a single {@link AlgoSignal}.
 *
 * Returns `null` on success (the signal was fully processed for every
 * applicable mode) or a French skip/failure reason string when the pipeline
 * bailed out before enqueuing any order.
 *
 * Mode handling mirrors the copy entry pipeline: `'sim'` always runs, `'real'`
 * only runs when `globalConfig.realTradingEnabled` is true. Each mode is independent —
 * a skip in one mode does not abort the other.
 */
export async function runAlgoEntryPipeline(
  params: AlgoEntryPipelineParams,
): Promise<string | null> {
  const {
    signal,
    risk,
    watchlistId,
    connectionManager,
    reservationService,
    simulationService,
    marketService,
    orderQueue,
    ds,
    redisCmd,
    backendUrl,
    serviceToken,
    realTradingEnabled,
  } = params;

  if (!risk.cryptoAlgoEnabled) {
    log.warn({ conditionId: signal.conditionId }, 'crypto-algo disabled — skipping entry');
    return 'Crypto-algo désactivé';
  }

  // --- Load market ---------------------------------------------------------
  const markets = await marketService.loadByConditionIds([signal.conditionId]);
  const market = markets.get(signal.conditionId);
  if (!market) {
    log.warn(
      { conditionId: signal.conditionId },
      'entry skipped — market not found',
    );
    return 'Marché introuvable';
  }

  const marketInterval = resolveMarketInterval(market, signal.interval);

  const minTimeToClose = resolveCryptoAlgoMinTimeToClose(risk, marketInterval);
  if (minTimeToClose > 0 && market.endDate) {
    const timeToEndMs = new Date(market.endDate).getTime() - Date.now();
    if (timeToEndMs <= minTimeToClose * 1000) {
      log.warn(
        {
          conditionId: signal.conditionId,
          interval: marketInterval,
          timeToEndMs,
          minTimeToClose,
        },
        'entry skipped — market closes too soon for pre-close exit',
      );
      return 'Marché se clôture trop tôt';
    }
  }

  // --- Rough liquidity probe (qty = 1) -------------------------------------
  const roughPrices = await connectionManager.fetchExecutablePrices(
    signal.assetId,
    1,
  );
  const roughAskVwap = roughPrices.executableAskVwap;
  if (roughAskVwap <= 0) {
    log.warn(
      { conditionId: signal.conditionId, assetId: signal.assetId },
      'entry skipped — no liquidity for rough VWAP',
    );
    return 'Pas de liquidité';
  }

  const upstreamLiquidity = await gateAlgoEntryAskLiquidity({
    conditionId: signal.conditionId,
    assetId: signal.assetId,
    connectionManager,
    clobApi: CLOB_API,
    maxRetries: 1,
    delayMs: 250,
  });
  if (upstreamLiquidity) {
    log.warn(
      { conditionId: signal.conditionId, assetId: signal.assetId, skipReason: upstreamLiquidity },
      'entry skipped — upstream ask depth gate',
    );
    return upstreamLiquidity;
  }

  // --- Per-mode processing -------------------------------------------------
  const modes: TradingMode[] = ['sim', 'real'];
  let anyModeEnqueued = false;

  for (const mode of modes) {
    if (mode === 'real' && !realTradingEnabled) {
      continue;
    }

    let modeResult: string | null = null;
    try {
      modeResult = await runMode({
        signal,
        risk,
        watchlistId,
        mode,
        marketInterval,
        roughAskVwap,
        connectionManager,
        reservationService,
        simulationService,
        orderQueue,
        ds,
        redisCmd,
        backendUrl,
        serviceToken,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fr = mapReservationError(msg);
      if (fr) {
        log.warn(
          { err, conditionId: signal.conditionId, mode, signalId: undefined },
          'algo entry mode skipped — reservation error',
        );
        modeResult = fr;
      } else {
        // Unknown / transient error — log and continue to the next mode so one
        // mode failure does not mask another, but surface it via the final
        // aggregated result when nothing succeeded.
        log.error(
          { err, conditionId: signal.conditionId, mode },
          'algo entry mode failed — unexpected error',
        );
        modeResult = `Échec mode ${mode}`;
      }
    }

    if (modeResult === null) {
      anyModeEnqueued = true;
    } else {
      log.warn(
        { conditionId: signal.conditionId, mode, reason: modeResult },
        'algo entry mode skipped',
      );
    }
  }

  // When at least one mode enqueued an order, the pipeline succeeded overall.
  // Otherwise return the most useful failure reason. We prefer a hard
  // liquidity/market reason from the pre-loop checks (already returned above);
  // here both modes either skipped or failed, so surface a generic reason.
  return anyModeEnqueued ? null : 'Aucun mode exécutable';
}

/**
 * Run the entry pipeline for a single trading mode. Returns `null` on success
 * (order enqueued) or a French skip-reason string.
 */
async function runMode(args: {
  signal: AlgoSignal;
  risk: CryptoConfig;
  watchlistId: number;
  mode: TradingMode;
  marketInterval: string | null;
  roughAskVwap: number;
  connectionManager: IPolymarketConnectionManager;
  reservationService: ReservationService;
  simulationService: SimulationService;
  orderQueue: RedisQueue<OrderSignal>;
  ds: DataSource;
  redisCmd: Pick<Redis, 'exists'>;
  backendUrl: string;
  serviceToken: string;
}): Promise<string | null> {
  const {
    signal,
    risk,
    watchlistId,
    mode,
    marketInterval,
    roughAskVwap,
    connectionManager,
    reservationService,
    simulationService,
    orderQueue,
    ds,
    redisCmd,
    backendUrl,
    serviceToken,
  } = args;

  if (await hasAlgoEntryCooldown(redisCmd, signal.conditionId, mode)) {
    log.debug(
      { conditionId: signal.conditionId, mode },
      'entry skipped — post-execution cooldown active',
    );
    return 'Cooldown exécution actif';
  }

  const slQuotaBlock = await resolveSlQuotaEntryBlock({
    ds,
    conditionId: signal.conditionId,
    mode,
    risk,
  });
  if (slQuotaBlock) {
    log.warn(
      { conditionId: signal.conditionId, mode, reason: slQuotaBlock },
      'algo entry skipped — SL quota (mode-scoped)',
    );
    return slQuotaBlock;
  }

  const exit: AlgoEntryExitParams = resolveAlgoEntryExitParams(
    risk,
    mode,
    marketInterval,
  );

  const algoKeyParams = {
    conditionId: signal.conditionId,
    interval: signal.interval,
    outcome: signal.outcome,
    strategyId: signal.strategyId,
    mode,
  };
  const logicalKey = hashAlgoLogicalKey(algoKeyParams);

  const existingReservation =
    await reservationService.findActiveAlgoReservation({
      watchlistId,
      conditionId: signal.conditionId,
      assetId: signal.assetId,
      mode,
    });
  if (existingReservation) {
    const executionService = new ExecutionService(ds);
    if (await executionService.hasInFlightBuy(existingReservation.copiedPositionId)) {
      return null;
    }
    if (await orderQueue.hasDedupeMarker(logicalKey)) {
      return null;
    }
    try {
      const skipReason = await resumeEntryFromReservation({
        conditionId: signal.conditionId,
        assetId: signal.assetId,
        mode,
        signalId: existingReservation.orderSignalId,
        logicalKey,
        reason: 'ALGO_OPEN',
        reservation: existingReservation,
        connectionManager,
        reservationService,
        orderQueue,
        hasBuyExecution: () =>
          executionService.hasBuyForPosition(existingReservation.copiedPositionId),
        hasInFlightBuy: () =>
          executionService.hasInFlightBuy(existingReservation.copiedPositionId),
        resolveEffectiveEntryMos: async ({ conditionId, assetId }) => {
          const detailed = await resolveEntryMinOrderSharesDetailed({
            conditionId,
            assetId,
            clobApi: CLOB_API,
          });
          return effectiveEntryMos(detailed);
        },
      });
      if (skipReason) {
        log.warn(
          {
            conditionId: signal.conditionId,
            signalId: existingReservation.orderSignalId,
            skipReason,
          },
          'algo resume skipped — reservation released',
        );
      }
      return skipReason;
    } catch (err) {
      log.warn(
        {
          err,
          conditionId: signal.conditionId,
          mode,
          signalId: existingReservation.orderSignalId,
        },
        'order enqueue failed on algo resume — will retry',
      );
      throw err;
    }
  }

  const sizing = getCryptoAlgoSizingParams(risk);

  // --- Balances ------------------------------------------------------------
  // For sim mode, use simulation service. For real mode, fetch from backend
  // (or use override from GlobalConfig).
  const realCashOverride =
    mode === 'real'
      ? await fetchAvailableRealCash(ds, backendUrl, serviceToken)
      : undefined;

  let balances;
  try {
    balances = await resolveEntryBalances(
      mode,
      sizing.sizingMode,
      simulationService,
      'crypto',
      realCashOverride,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'real_cash_unavailable') {
      log.warn(
        { conditionId: signal.conditionId, mode },
        'real mode skipped — real cash unavailable',
      );
      return 'Cash réel indisponible';
    }
    throw err;
  }

  // --- Target quantity (rough VWAP) ----------------------------------------
  const estimatedTargetQty = computeEntryTargetQuantity({
    sizing,
    askVwap: roughAskVwap,
    traderDelta: 0,
    previousTraderSize: 0,
    balances,
    traderPortfolioValue: undefined,
    maxPositionSizeUsdc: getCryptoMaxPositionSizeUsdc(risk, mode),
    signalScore: undefined,
    stopDistance: undefined,
  });

  if (!estimatedTargetQty || estimatedTargetQty < MIN_ORDER_SHARES) {
    log.warn(
      { conditionId: signal.conditionId, mode, roughAskVwap, estimatedTargetQty },
      'algo entry skipped — estimated target quantity below minimum',
    );
    return 'Quantité estimée insuffisante';
  }

  // --- Refetch executable prices at target qty -----------------------------
  const prices = await connectionManager.fetchExecutablePrices(
    signal.assetId,
    estimatedTargetQty,
  );
  const askVwap = prices.executableAskVwap;
  if (askVwap <= 0) {
    log.warn(
      { conditionId: signal.conditionId, assetId: signal.assetId, mode },
      'algo entry skipped — no liquidity at estimated quantity',
    );
    return 'Pas de liquidité à la quantité estimée';
  }

  // Recompute target qty at the tighter VWAP for the final notional.
  const targetQty = computeEntryTargetQuantity({
    sizing,
    askVwap,
    traderDelta: 0,
    previousTraderSize: 0,
    balances,
    traderPortfolioValue: undefined,
    maxPositionSizeUsdc: getCryptoMaxPositionSizeUsdc(risk, mode),
    signalScore: undefined,
    stopDistance: undefined,
  });

  if (!targetQty || targetQty < MIN_ORDER_SHARES) {
    log.warn(
      { conditionId: signal.conditionId, mode, askVwap, targetQty },
      'algo entry skipped — target quantity below minimum order size',
    );
    return 'Quantité cible insuffisante';
  }

  const mosGate = await applyEntryMosGate({
    targetQty,
    askVwap,
    cash: balances.cash,
    maxPositionSizeUsdc: getCryptoMaxPositionSizeUsdc(risk, mode),
    conditionId: signal.conditionId,
    assetId: signal.assetId,
    clobApi: CLOB_API,
    connectionManager,
  });
  if (!mosGate.ok) {
    log.warn(
      {
        conditionId: signal.conditionId,
        mode,
        targetQty,
        skipReason: mosGate.skipReason,
      },
      'algo entry skipped — MOS gate',
    );
    return mosGate.skipReason;
  }

  const finalQty = mosGate.quantity;
  const finalAskVwap = mosGate.askVwap;
  if (mosGate.bumped) {
    log.info(
      {
        conditionId: signal.conditionId,
        mode,
        originalQty: targetQty,
        bumpedQty: finalQty,
        effectiveMos: mosGate.effectiveMos,
      },
      'algo entry quantity bumped to market MOS',
    );
  }

  const depthResult = await fetchEntryAskLiquidityWithRetries({
    assetId: signal.assetId,
    targetQty: finalQty,
    maxRetries: getCryptoEntryDepthRetryMax(risk, mode),
    delayMs: getCryptoEntryDepthRetryDelayMs(risk, mode),
    connectionManager,
  });
  if (!depthResult.ok) {
    log.warn(
      {
        conditionId: signal.conditionId,
        mode,
        targetQty: finalQty,
        attempts: depthResult.attempts,
        skipReason: depthResult.skipReason,
      },
      'algo entry skipped — insufficient ask depth after retries',
    );
    return depthResult.skipReason;
  }

  const entryAskVwap = depthResult.prices.executableAskVwap;
  const targetNotionalUsdc = finalQty * entryAskVwap;
  if (mode === 'real' && targetNotionalUsdc < MIN_ORDER_USDC) {
    log.warn(
      { conditionId: signal.conditionId, mode, targetQty, targetNotionalUsdc },
      'algo entry skipped — real target notional below minimum',
    );
    return `Montant cible réel insuffisant (${MIN_ORDER_USDC} USDC)`;
  }

  // --- Reserve + enqueue ---------------------------------------------------
  let reserved = false;
  let releaseSignalId: string | null = null;
  try {
    const reservation = await reservationService.reserve({
      orderSignalId: logicalKey,
      watchlistId,
      conditionId: signal.conditionId,
      assetId: signal.assetId,
      mode,
      notionalUsdc: targetNotionalUsdc,
      reason: 'ALGO_OPEN',
      outcome: signal.outcome,
      trailingBidPoints: exit.trailingBidPoints ?? undefined,
      trailingActivationBidPoints: exit.trailingActivationBidPoints ?? undefined,
      slBidPoints: exit.slBidPoints ?? undefined,
      tpBidPoints: exit.tpBidPoints ?? undefined,
    });
    reserved = true;

    const orderSignalId = hashAlgoOrderSignalId({
      ...algoKeyParams,
      copiedPositionId: reservation.copiedPositionId,
    });
    await reservationService.updateOrderSignalId(
      reservation.reservationId,
      orderSignalId,
    );
    releaseSignalId = orderSignalId;

    const executionService = new ExecutionService(ds);
    const enqueueTtlSeconds = Math.max(
      1,
      Math.ceil((reservation.expiresAt.getTime() - Date.now()) / 1000),
    );
    const enqueued = await enqueueEntrySignal({
      orderQueue,
      dedupeKey: logicalKey,
      ttlSeconds: enqueueTtlSeconds,
      hasBuyExecution: () =>
        executionService.hasBuyForPosition(reservation.copiedPositionId),
      hasInFlightBuy: () =>
        executionService.hasInFlightBuy(reservation.copiedPositionId),
      job: {
        id: orderSignalId,
        copiedPositionId: reservation.copiedPositionId,
        reservationId: reservation.reservationId,
        conditionId: signal.conditionId,
        assetId: signal.assetId,
        side: 'BUY',
        quantity: finalQty,
        usdcAmount: targetNotionalUsdc,
        orderType: 'FOK',
        referenceVwap: entryAskVwap,
        reason: 'ALGO_OPEN',
        mode,
      },
    });

    const enqueueBlocked = await resolveEntryEnqueueBlocked({
      enqueued,
      orderQueue,
      dedupeKey: logicalKey,
      orderSignalId,
      reservationService,
      hasBuyExecution: () =>
        executionService.hasBuyForPosition(reservation.copiedPositionId),
      hasInFlightBuy: () =>
        executionService.hasInFlightBuy(reservation.copiedPositionId),
      blockedReason: 'Enqueue file bloqué (dedup)',
    });
    if (enqueueBlocked) {
      log.warn(
        {
          conditionId: signal.conditionId,
          mode,
          logicalKey,
          orderSignalId,
          reason: enqueueBlocked,
        },
        'algo entry enqueue blocked after reserve',
      );
      return enqueueBlocked;
    }

    log.info(
      {
        conditionId: signal.conditionId,
        mode,
        logicalKey,
        orderSignalId,
        copiedPositionId: reservation.copiedPositionId,
        deduped: false,
      },
      'algo entry enqueued',
    );
  } catch (err) {
    if (reserved) {
      const releaseId = releaseSignalId ?? logicalKey;
      await reservationService.release(releaseId, 'pipeline_error').catch((releaseErr) =>
        log.warn(
          { err: releaseErr, conditionId: signal.conditionId, signalId: releaseId },
          'failed to release reservation after pipeline error',
        ),
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      { err, conditionId: signal.conditionId, mode, logicalKey },
      'reservation or enqueue failed',
    );
    const mapped = mapReservationError(msg);
    if (mapped) return mapped;
    // Transient errors (e.g. Redis down during enqueue after a successful
    // reservation) must propagate so the caller can retry the whole signal.
    if (reserved) {
      log.warn(
        { err, conditionId: signal.conditionId, mode, logicalKey },
        'enqueue failed after reservation — releasing and rethrowing for retry',
      );
      throw err;
    }
    return 'Échec de la réservation';
  }

  return null;
}

/**
 * Map a reservation-service error code to a French skip reason. Returns
 * `null` for unknown / transient errors so the caller can decide to rethrow.
 */
function mapReservationError(msg: string): string | null {
  switch (msg) {
    case 'crypto_algo_disabled':
      return 'Crypto-algo désactivé';
    case 'real_trading_disabled':
      return 'Trading réel désactivé';
    case 'insufficient_cash':
      return 'Cash simulation insuffisant';
    case 'max_open_positions':
      return 'Nombre maximum de positions ouvertes atteint';
    case 'max_exposure':
      return 'Exposition maximum atteinte';
    case 'position_already_active':
      return 'Position déjà active';
    default:
      return null;
  }
}