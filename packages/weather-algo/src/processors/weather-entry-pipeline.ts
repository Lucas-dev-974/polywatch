import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import pino from 'pino';
import {
  type OrderSignal,
  type RiskConfig,
  type RedisQueue,
  type IPolymarketConnectionManager,
  type MarketService,
  type ReservationService,
  type SimulationService,
  type TradingMode,
  type AlgoEntryExitParams,
  type SignalScore,
  hashAlgoLogicalKey,
  hashAlgoOrderSignalId,
  computeEntryTargetQuantity,
  getModeMaxPositionSizeUsdc,
  resolveEntryBalances,
  applyEntryMosGate,
  fetchEntryAskLiquidityWithRetries,
  getModeEntryDepthRetryMax,
  getModeEntryDepthRetryDelayMs,
  enqueueEntrySignal,
  resolveEntryEnqueueBlocked,
  hasAlgoEntryCooldown,
  MIN_ORDER_SHARES,
  resumeEntryFromReservation,
  ExecutionService,
  resolveAlgoEntryExitParams,
  WeatherForecastService,
  WeatherPositionForecastService,
} from '@polywatch/core';
import type { WeatherSignal } from '../strategy/strategy.js';
import { fetchAvailableRealCash } from '../real-cash.js';

const CLOB_API = process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com';

const log = pino({ name: 'weather-algo:entry-pipeline' });

export interface WeatherEntryPipelineParams {
  signal: WeatherSignal;
  risk: RiskConfig;
  watchlistId: number;
  connectionManager: IPolymarketConnectionManager;
  reservationService: ReservationService;
  simulationService: SimulationService;
  marketService: MarketService;
  orderQueue: RedisQueue<OrderSignal>;
  redisCmd: Pick<Redis, 'exists'>;
  ds: DataSource;
  backendUrl: string;
  serviceToken: string;
  forecastService?: WeatherForecastService;
  positionForecastService?: WeatherPositionForecastService;
}

/**
 * Run the weather-algo entry pipeline for a single {@link WeatherSignal}.
 *
 * Returns `null` when at least one mode successfully enqueues an order,
 * or a French skip/failure reason string otherwise.
 */
export async function runWeatherEntryPipeline(
  params: WeatherEntryPipelineParams,
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
    redisCmd,
    ds,
    backendUrl,
    serviceToken,
  } = params;

  if (!risk.weatherAlgoEnabled) {
    log.warn({ conditionId: signal.conditionId }, 'weather-algo disabled — skipping entry');
    return 'Weather-algo désactivé';
  }

  // --- Load market ---------------------------------------------------------
  const markets = await marketService.loadByConditionIds([signal.conditionId]);
  const market = markets.get(signal.conditionId);
  if (!market) {
    log.warn({ conditionId: signal.conditionId }, 'entry skipped — market not found');
    return 'Marché introuvable';
  }

  // --- Pre-close check -----------------------------------------------------
  const minHoursToClose = risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
  if (market.endDate) {
    const hoursToEnd = (new Date(market.endDate).getTime() - Date.now()) / 3_600_000;
    if (hoursToEnd <= minHoursToClose) {
      log.warn(
        { conditionId: signal.conditionId, hoursToEnd, minHoursToClose },
        'entry skipped — market closes too soon',
      );
      return 'Marché se clôture trop tôt';
    }
  }

  // --- Rough liquidity probe (qty = 1) -------------------------------------
  const roughPrices = await connectionManager.fetchExecutablePrices(signal.assetId, 1);
  const roughAskVwap = roughPrices.executableAskVwap;
  if (roughAskVwap <= 0) {
    log.warn(
      { conditionId: signal.conditionId, assetId: signal.assetId },
      'entry skipped — no liquidity for rough VWAP',
    );
    return 'Pas de liquidité';
  }

  // --- Per-mode processing -------------------------------------------------
  const modes: TradingMode[] = ['sim', 'real'];
  let anyModeEnqueued = false;

  for (const mode of modes) {
    if (mode === 'real' && !risk.realTradingEnabled) continue;

    let modeResult: string | null = null;
    try {
      modeResult = await runMode({
        signal,
        risk,
        watchlistId,
        mode,
        roughAskVwap,
        connectionManager,
        reservationService,
        simulationService,
        orderQueue,
        redisCmd,
        ds,
        backendUrl,
        serviceToken,
        forecastService: params.forecastService,
        positionForecastService: params.positionForecastService,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, conditionId: signal.conditionId, mode }, 'weather entry mode failed');
      modeResult = `Échec mode ${mode}: ${msg}`;
    }

    if (modeResult === null) {
      anyModeEnqueued = true;
    } else {
      log.warn({ conditionId: signal.conditionId, mode, reason: modeResult }, 'weather entry mode skipped');
    }
  }

  return anyModeEnqueued ? null : 'Aucun mode exécutable';
}

async function runMode(args: {
  signal: WeatherSignal;
  risk: RiskConfig;
  watchlistId: number;
  mode: TradingMode;
  roughAskVwap: number;
  connectionManager: IPolymarketConnectionManager;
  reservationService: ReservationService;
  simulationService: SimulationService;
  orderQueue: RedisQueue<OrderSignal>;
  redisCmd: Pick<Redis, 'exists'>;
  ds: DataSource;
  backendUrl: string;
  serviceToken: string;
  forecastService?: WeatherForecastService;
  positionForecastService?: WeatherPositionForecastService;
}): Promise<string | null> {
  const {
    signal,
    risk,
    watchlistId,
    mode,
    roughAskVwap,
    connectionManager,
    reservationService,
    simulationService,
    orderQueue,
    redisCmd,
    ds,
    backendUrl,
    serviceToken,
  } = args;

  if (await hasAlgoEntryCooldown(redisCmd, signal.conditionId, mode)) {
    log.debug({ conditionId: signal.conditionId, mode }, 'entry skipped — post-execution cooldown active');
    return 'Cooldown exécution actif';
  }

  const exit: AlgoEntryExitParams = resolveAlgoEntryExitParams(risk, mode, null);

  const algoKeyParams = {
    conditionId: signal.conditionId,
    interval: 'weather',
    outcome: signal.outcome,
    strategyId: signal.strategyId,
    mode,
  };
  const logicalKey = hashAlgoLogicalKey(algoKeyParams);

  // --- Existing reservation handling ----------------------------------------
  const existingReservation = await reservationService.findActiveAlgoReservation({
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

    const skipReason = await resumeEntryFromReservation({
      conditionId: signal.conditionId,
      assetId: signal.assetId,
      mode,
      signalId: existingReservation.orderSignalId,
      logicalKey,
      reason: 'WEATHER_OPEN',
      reservation: existingReservation,
      connectionManager,
      reservationService,
      orderQueue,
      hasBuyExecution: () =>
        executionService.hasBuyForPosition(existingReservation.copiedPositionId),
      hasInFlightBuy: () =>
        executionService.hasInFlightBuy(existingReservation.copiedPositionId),
      resolveEffectiveEntryMos: async ({ conditionId, assetId }) => {
        const { effectiveEntryMos } = await import('@polywatch/core');
        const { resolveEntryMinOrderSharesDetailed } = await import('@polywatch/core');
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
        { conditionId: signal.conditionId, signalId: existingReservation.orderSignalId, skipReason },
        'weather resume skipped — reservation released',
      );
    }
    return skipReason;
  }

  // --- Sizing ---------------------------------------------------------------
  const sizing: import('@polywatch/core').ModeSizingParams = {
    sizingMode: 'fixed_usdc',
    copyRatio: 1,
    fixedUsdcAmount: risk.weatherAlgoEntryUsdc ?? 10,
    fixedShareCount: 0,
    signalScoreSizingEnabled: false,
  };

  // --- Balances -------------------------------------------------------------
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
      realCashOverride,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'real_cash_unavailable') {
      log.warn({ conditionId: signal.conditionId, mode }, 'real mode skipped — real cash unavailable');
      return 'Cash réel indisponible';
    }
    throw err;
  }

  const signalScore: SignalScore | undefined = signal.confidence > 0
    ? { score: signal.confidence, multiplier: 1, reasons: signal.reasons }
    : undefined;

  // --- Target quantity (rough VWAP) -----------------------------------------
  const estimatedTargetQty = computeEntryTargetQuantity({
    sizing,
    askVwap: roughAskVwap,
    traderDelta: 0,
    previousTraderSize: 0,
    balances,
    traderPortfolioValue: undefined,
    maxPositionSizeUsdc: getModeMaxPositionSizeUsdc(risk, mode),
    signalScore,
    stopDistance: undefined,
  });

  if (!estimatedTargetQty || estimatedTargetQty < MIN_ORDER_SHARES) {
    log.warn(
      { conditionId: signal.conditionId, mode, roughAskVwap, estimatedTargetQty },
      'weather entry skipped — estimated target quantity below minimum',
    );
    return 'Quantité estimée insuffisante';
  }

  // --- Refetch executable prices at target qty -------------------------------
  const prices = await connectionManager.fetchExecutablePrices(signal.assetId, estimatedTargetQty);
  const askVwap = prices.executableAskVwap;
  if (askVwap <= 0) {
    log.warn({ conditionId: signal.conditionId, assetId: signal.assetId, mode }, 'weather entry skipped — no liquidity at estimated quantity');
    return 'Pas de liquidité à la quantité estimée';
  }

  const targetQty = computeEntryTargetQuantity({
    sizing,
    askVwap,
    traderDelta: 0,
    previousTraderSize: 0,
    balances,
    traderPortfolioValue: undefined,
    maxPositionSizeUsdc: getModeMaxPositionSizeUsdc(risk, mode),
    signalScore,
    stopDistance: undefined,
  });

  if (!targetQty || targetQty < MIN_ORDER_SHARES) {
    log.warn({ conditionId: signal.conditionId, mode, askVwap, targetQty }, 'weather entry skipped — target quantity below minimum order size');
    return 'Quantité cible insuffisante';
  }

  // --- MOS gate --------------------------------------------------------------
  const mosGate = await applyEntryMosGate({
    targetQty,
    askVwap,
    cash: balances.cash,
    maxPositionSizeUsdc: getModeMaxPositionSizeUsdc(risk, mode),
    conditionId: signal.conditionId,
    assetId: signal.assetId,
    clobApi: CLOB_API,
    connectionManager,
  });
  if (!mosGate.ok) {
    log.warn(
      { conditionId: signal.conditionId, mode, targetQty, skipReason: mosGate.skipReason },
      'weather entry skipped — MOS gate',
    );
    return mosGate.skipReason;
  }

  const finalQty = mosGate.quantity;
  const finalAskVwap = mosGate.askVwap;
  if (mosGate.bumped) {
    log.info(
      { conditionId: signal.conditionId, mode, originalQty: targetQty, bumpedQty: finalQty },
      'weather entry quantity bumped to market MOS',
    );
  }

  // --- Depth retry -----------------------------------------------------------
  const depthResult = await fetchEntryAskLiquidityWithRetries({
    assetId: signal.assetId,
    targetQty: finalQty,
    maxRetries: getModeEntryDepthRetryMax(risk, mode),
    delayMs: getModeEntryDepthRetryDelayMs(risk, mode),
    connectionManager,
  });
  if (!depthResult.ok) {
    log.warn(
      { conditionId: signal.conditionId, mode, targetQty: finalQty, attempts: depthResult.attempts },
      'weather entry skipped — insufficient depth',
    );
    return depthResult.skipReason ?? 'Profondeur insuffisante';
  }

  // --- Reservation ----------------------------------------------------------
  const reservation = await reservationService.reserve({
    orderSignalId: logicalKey,
    watchlistId,
    conditionId: signal.conditionId,
    assetId: signal.assetId,
    mode,
    notionalUsdc: finalQty * finalAskVwap,
    reason: 'WEATHER_OPEN',
    outcome: signal.outcome,
    trailingBidPoints: exit.trailingBidPoints ?? undefined,
    trailingActivationBidPoints: exit.trailingActivationBidPoints ?? undefined,
    slBidPoints: exit.slBidPoints ?? undefined,
    tpBidPoints: exit.tpBidPoints ?? undefined,
  });

  const orderSignalId = hashAlgoOrderSignalId({
    conditionId: signal.conditionId,
    interval: 'weather',
    outcome: signal.outcome,
    strategyId: signal.strategyId,
    mode,
    copiedPositionId: reservation.copiedPositionId,
  });

  await reservationService.updateOrderSignalId(reservation.reservationId, orderSignalId);

  // --- Enqueue signal ---------------------------------------------------------
  const orderSignal: OrderSignal = {
    id: orderSignalId,
    copiedPositionId: reservation.copiedPositionId,
    reservationId: reservation.reservationId,
    conditionId: signal.conditionId,
    assetId: signal.assetId,
    side: 'BUY',
    quantity: finalQty,
    usdcAmount: finalQty * finalAskVwap,
    orderType: 'GTC',
    limitPrice: finalAskVwap,
    referenceVwap: finalAskVwap,
    reason: 'WEATHER_OPEN',
    mode,
  };

  const executionService = new ExecutionService(ds);
  const enqueued = await enqueueEntrySignal({
    orderQueue,
    job: orderSignal,
    dedupeKey: logicalKey,
    ttlSeconds: 300,
    hasBuyExecution: () => executionService.hasBuyForPosition(reservation.copiedPositionId),
    hasInFlightBuy: () => executionService.hasInFlightBuy(reservation.copiedPositionId),
  });

  const blockedReason = await resolveEntryEnqueueBlocked({
    enqueued,
    orderQueue,
    dedupeKey: logicalKey,
    orderSignalId,
    reservationService,
    hasBuyExecution: () => executionService.hasBuyForPosition(reservation.copiedPositionId),
    hasInFlightBuy: () => executionService.hasInFlightBuy(reservation.copiedPositionId),
    blockedReason: "Échec d'enqueue",
  });

  if (blockedReason === null) {
    log.info(
      {
        conditionId: signal.conditionId,
        mode,
        amount: finalQty,
        price: finalAskVwap,
        orderSignalId,
      },
      'weather entry signal enqueued',
    );
    await persistEntryForecastSnapshot({
      ds,
      signal,
      copiedPositionId: reservation.copiedPositionId,
      forecastService: args.forecastService,
      positionForecastService: args.positionForecastService,
    });
    return null;
  }

  log.warn(
    { conditionId: signal.conditionId, mode, skipReason: blockedReason },
    'weather entry signal enqueue failed',
  );
  return blockedReason;
}

export async function createWeatherEntryPipeline(params: WeatherEntryPipelineParams): Promise<(signal: WeatherSignal) => Promise<string | null>> {
  return (signal: WeatherSignal) => runWeatherEntryPipeline({ ...params, signal });
}

async function persistEntryForecastSnapshot(args: {
  ds: DataSource;
  signal: WeatherSignal;
  copiedPositionId: number;
  forecastService?: WeatherForecastService;
  positionForecastService?: WeatherPositionForecastService;
}): Promise<void> {
  const { signal, copiedPositionId } = args;
  const forecastService = args.forecastService ?? new WeatherForecastService(args.ds);
  const positionForecastService =
    args.positionForecastService ?? new WeatherPositionForecastService(args.ds);

  try {
    let modelValues: Record<string, number> = {};
    const cached = await forecastService.getCached(
      signal.city,
      signal.targetDate,
      signal.metric,
    );
    if (cached?.modelValues && Object.keys(cached.modelValues).length > 0) {
      modelValues = cached.modelValues;
    }

    await positionForecastService.saveIfAbsent({
      copiedPositionId,
      city: signal.city,
      targetDate: signal.targetDate,
      metric: signal.metric,
      entryForecastMean: signal.forecastMean,
      entryForecastStdDev: signal.forecastStdDev,
      entryModelValues: modelValues,
      entryBucketComparison: signal.entryBucketComparison ?? null,
      entryBucketBounds: signal.entryBucketBounds ?? null,
    });
  } catch (err) {
    log.error(
      { err, copiedPositionId, conditionId: signal.conditionId },
      'failed to persist weather entry forecast snapshot — entry still enqueued',
    );
  }
}