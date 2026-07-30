import {
  computeSignalScore,
  hashCopyOrderSignalId,
  resolveCopyEntryExitParams,
  getCopyMaxPositionSizeUsdc,
  getCopySizingParams,
  getCopyMinBidToAskRatio,
  getCopyMinTimeToClose,
  getCopyMomentumFilterEnabled,
  evaluateMomentumEntry,
  isEntryBidAskRatioAcceptable,
  Market,
  MarketService,
  ReservationService,
  SimulationService,
  type CopyConfig,
  computeEntryTargetQuantity,
  resolveEntryBalances,
  resumeEntryFromReservation,
  applyEntryMosGate,
  effectiveEntryMos,
  resolveEntryMinOrderSharesDetailed,
  fetchEntryAskLiquidityWithRetries,
  getCopyEntryDepthRetryMax,
  getCopyEntryDepthRetryDelayMs,
  enqueueEntrySignal,
  resolveEntryEnqueueBlocked,
  MIN_ORDER_SHARES,
  MIN_ORDER_USDC,
  type IPolymarketConnectionManager,
  type MoveEventDto,
  type OrderSignal,
  type RedisQueue,
  type SignalScore,
  type TradingMode,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { resolveTraderPortfolioValue } from '../../sizing/resolve-trader-portfolio.js';
import { fetchAvailableRealCash } from '../../sizing/real-cash.js';
import { config } from '../../config.js';
import type { WatchlistEntry } from './copy-risk-gate.js';

const log = pino({ name: 'copy-entry-pipeline' });

async function resolveEffectiveEntryMos(params: {
  conditionId: string;
  assetId: string;
}): Promise<number> {
  const detailed = await resolveEntryMinOrderSharesDetailed({
    conditionId: params.conditionId,
    assetId: params.assetId,
    clobApi: config.clobApi,
  });
  return effectiveEntryMos(detailed);
}

export async function runCopyEntryPipeline(params: {
  move: MoveEventDto;
  entry: WatchlistEntry;
  mode: TradingMode;
  copyConfig: CopyConfig;
  connectionManager: IPolymarketConnectionManager;
  marketService: MarketService;
  reservationService: ReservationService;
  simulationService: SimulationService;
  orderQueue: RedisQueue<OrderSignal>;
  ds: DataSource;
}): Promise<string | null> {
  const {
    move,
    entry,
    mode,
    copyConfig,
    connectionManager,
    marketService,
    reservationService,
    simulationService,
    orderQueue,
    ds,
  } = params;

  const sizing = getCopySizingParams(copyConfig, mode);
  const exit = resolveCopyEntryExitParams(copyConfig, mode);
  const reason = move.type === 'OPENED' ? 'COPY_OPEN' : 'COPY_INCREASE';
  const signalId = hashCopyOrderSignalId({
    moveEventId: move.id,
    mode,
    reason,
    side: 'BUY',
  });

  const existingReservation =
    await reservationService.findByOrderSignalId(signalId);
  if (existingReservation) {
    try {
      const skipReason = await resumeEntryFromReservation({
        conditionId: move.conditionId,
        assetId: move.assetId,
        mode,
        signalId,
        reason,
        reservation: existingReservation,
        connectionManager,
        reservationService,
        orderQueue,
        resolveEffectiveEntryMos,
      });
      if (skipReason) {
        log.warn(
          { moveId: move.id, signalId, skipReason },
          'resume skipped — reservation released',
        );
      }
      return skipReason;
    } catch (err) {
      log.warn({ err, moveId: move.id, signalId }, 'order enqueue failed on resume — will retry');
      throw err;
    }
  }

  const [realCashOverride, portfolio, markets] = await Promise.all([
    mode === 'real' ? fetchAvailableRealCash(ds) : Promise.resolve(undefined),
    resolveTraderPortfolioValue(move.traderAddress, sizing.sizingMode),
    marketService.loadByConditionIds([move.conditionId]),
  ]);

  let balances;
  try {
    balances = await resolveEntryBalances(
      mode,
      sizing.sizingMode,
      simulationService,
      'copy',
      realCashOverride,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'real_cash_unavailable') {
      log.warn(
        { moveId: move.id, mode },
        'real mode skipped — real cash unavailable',
      );
      return 'Cash réel indisponible';
    }
    throw err;
  }
  const traderDelta = move.traderSize - move.previousTraderSize;
  if (portfolio.ok === false && portfolio.reason === 'fetch_failed') {
    log.warn(
      { err: portfolio.error, moveId: move.id, trader: move.traderAddress },
      'trader portfolio value fetch failed',
    );
    return 'Échec récupération valeur portefeuille trader';
  }
  if (portfolio.ok === false && portfolio.reason === 'zero') {
    log.warn(
      { moveId: move.id, trader: move.traderAddress },
      'entry skipped — trader portfolio value is zero',
    );
    return 'Valeur portefeuille trader nulle';
  }

  const minTimeToClose = getCopyMinTimeToClose(copyConfig, mode);
  const market = markets.get(move.conditionId);
  if (minTimeToClose > 0 && market?.endDate) {
    const timeToEndMs = market.endDate.getTime() - Date.now();
    if (timeToEndMs <= minTimeToClose * 1000) {
      log.warn(
        {
          moveId: move.id,
          mode,
          conditionId: move.conditionId,
          timeToEndMs,
          minTimeToClose,
        },
        'entry skipped — market closes in less than configured min time to close',
      );
      return 'Marché se clôture trop tôt';
    }
  }

  const roughPrices = await connectionManager.fetchExecutablePrices(
    move.assetId,
    1,
  );
  const roughAskVwap = roughPrices.executableAskVwap;
  const roughBidVwap = roughPrices.executableBidVwap;
  if (roughAskVwap <= 0) {
    log.warn(
      { moveId: move.id, assetId: move.assetId },
      'entry skipped — no liquidity for rough VWAP',
    );
    return 'Pas de liquidité (prix indicatif)';
  }

  const signalScore = computeEntrySignalScore(move, market, roughAskVwap, roughBidVwap);
  const applySignalScore = sizing.signalScoreSizingEnabled;
  if (applySignalScore && signalScore.multiplier < 0.2) {
    log.warn(
      { moveId: move.id, mode, reasons: signalScore.reasons },
      'entry skipped — signal score too low',
    );
    return `Score du signal trop faible${signalScore.reasons.length > 0 ? ` : ${signalScore.reasons.join(', ')}` : ''}`;
  }
  const entrySignalScore = applySignalScore ? signalScore : undefined;

  // Absolute bid-point distance (same unit as strategy SL: entryBid − slBidPoints).
  // Do not multiply by ask — computeRiskBasedSpend uses quantity = budget / stopDistance.
  const stopDistance =
    exit.slBidPoints != null && exit.slBidPoints > 0
      ? exit.slBidPoints
      : undefined;

  const sizingInputBase = {
    sizing,
    traderDelta,
    previousTraderSize: move.previousTraderSize,
    balances,
    traderPortfolioValue: portfolio.ok ? portfolio.value : undefined,
    maxPositionSizeUsdc: getCopyMaxPositionSizeUsdc(copyConfig, mode),
    signalScore: entrySignalScore,
    stopDistance,
  };

  const estimatedTargetQty = computeEntryTargetQuantity({
    ...sizingInputBase,
    askVwap: roughAskVwap,
  });

  if (!estimatedTargetQty || estimatedTargetQty <= 0) {
    log.warn(
      { moveId: move.id, mode, roughAskVwap, traderDelta },
      'entry skipped — zero estimated target quantity',
    );
    return 'Quantité estimée nulle';
  }

  const prices = await connectionManager.fetchExecutablePrices(
    move.assetId,
    estimatedTargetQty,
  );
  const askVwap = prices.executableAskVwap;
  if (askVwap <= 0) {
    log.warn(
      { moveId: move.id, assetId: move.assetId },
      'entry skipped — no liquidity at estimated quantity',
    );
    return 'Pas de liquidité à la quantité estimée';
  }

  const targetQty = computeEntryTargetQuantity({
    ...sizingInputBase,
    askVwap,
  });

  if (!targetQty || targetQty < MIN_ORDER_SHARES) {
    log.warn(
      {
        moveId: move.id,
        mode,
        askVwap,
        traderDelta,
        targetQty,
        minOrderShares: MIN_ORDER_SHARES,
      },
      'entry skipped — target quantity below minimum order size',
    );
    return 'Quantité cible inférieure au minimum';
  }

  const mosGate = await applyEntryMosGate({
    targetQty,
    askVwap,
    cash: balances.cash,
    maxPositionSizeUsdc: getCopyMaxPositionSizeUsdc(copyConfig, mode),
    conditionId: move.conditionId,
    assetId: move.assetId,
    clobApi: config.clobApi,
    connectionManager,
  });
  if (!mosGate.ok) {
    log.warn(
      { moveId: move.id, mode, targetQty, skipReason: mosGate.skipReason },
      'entry skipped — MOS gate',
    );
    return mosGate.skipReason;
  }

  const finalQty = mosGate.quantity;
  if (mosGate.bumped) {
    log.info(
      {
        moveId: move.id,
        mode,
        originalQty: targetQty,
        bumpedQty: finalQty,
        effectiveMos: mosGate.effectiveMos,
      },
      'entry quantity bumped to market MOS',
    );
  }

  const depthResult = await fetchEntryAskLiquidityWithRetries({
    assetId: move.assetId,
    targetQty: finalQty,
    maxRetries: getCopyEntryDepthRetryMax(copyConfig, mode),
    delayMs: getCopyEntryDepthRetryDelayMs(copyConfig, mode),
    connectionManager,
  });
  if (!depthResult.ok) {
    log.warn(
      {
        moveId: move.id,
        mode,
        targetQty: finalQty,
        attempts: depthResult.attempts,
        skipReason: depthResult.skipReason,
      },
      'entry skipped — insufficient ask depth after retries',
    );
    return depthResult.skipReason;
  }

  const entryAskVwap = depthResult.prices.executableAskVwap;
  const entryBidVwap = depthResult.prices.executableBidVwap;

  const targetNotionalUsdc = finalQty * entryAskVwap;
  if (mode === 'real' && targetNotionalUsdc < MIN_ORDER_USDC) {
    log.warn(
      {
        moveId: move.id,
        mode,
        targetQty: finalQty,
        targetNotionalUsdc,
        minOrderUsdc: MIN_ORDER_USDC,
      },
      'entry skipped — real target notional below minimum',
    );
    return `Montant cible inférieur au minimum live (${MIN_ORDER_USDC} USDC)`;
  }

  const minBidToAskRatio = getCopyMinBidToAskRatio(copyConfig, mode);
  if (
    !isEntryBidAskRatioAcceptable(
      entryBidVwap,
      entryAskVwap,
      minBidToAskRatio,
    )
  ) {
    log.warn(
      {
        moveId: move.id,
        mode,
        assetId: move.assetId,
        targetQty: finalQty,
        bidVwap: entryBidVwap,
        askVwap: entryAskVwap,
        bidToAskRatio: entryAskVwap > 0 ? entryBidVwap / entryAskVwap : 0,
        minBidToAskRatio,
      },
      'entry skipped — bid/ask ratio below minimum',
    );
    return 'Ratio bid/ask insuffisant';
  }

  const momentumRejection = applyMomentumGate({ move, copyConfig, mode, entryAskVwap });
  if (momentumRejection) return momentumRejection;

  let reserved = false;
  try {
    const reservation = await reservationService.reserve({
      orderSignalId: signalId,
      watchlistId: entry.id,
      conditionId: move.conditionId,
      assetId: move.assetId,
      mode,
      notionalUsdc: targetNotionalUsdc,
      reason,
      moveEventId: move.id,
      outcome: move.outcome,
      trailingBidPoints: exit.trailingBidPoints ?? undefined,
      trailingActivationBidPoints: exit.trailingActivationBidPoints ?? undefined,
      slBidPoints: exit.slBidPoints ?? undefined,
      tpBidPoints: exit.tpBidPoints ?? undefined,
    });
    reserved = true;

    const enqueueTtlSeconds = Math.max(
      1,
      Math.ceil((reservation.expiresAt.getTime() - Date.now()) / 1000),
    );
    const enqueued = await enqueueEntrySignal({
      orderQueue,
      dedupeKey: signalId,
      ttlSeconds: enqueueTtlSeconds,
      job: {
        id: signalId,
        copiedPositionId: reservation.copiedPositionId,
        reservationId: reservation.reservationId,
        conditionId: move.conditionId,
        assetId: move.assetId,
        side: 'BUY',
        quantity: finalQty,
        usdcAmount: targetNotionalUsdc,
        orderType: 'FAK',
        referenceVwap: entryAskVwap,
        reason,
        mode,
      },
    });

    const enqueueBlocked = await resolveEntryEnqueueBlocked({
      enqueued,
      orderQueue,
      dedupeKey: signalId,
      orderSignalId: signalId,
      reservationService,
      blockedReason: 'Enqueue file bloqué',
    });
    if (enqueueBlocked) {
      reserved = false; // release already handled by resolveEntryEnqueueBlocked
      return enqueueBlocked;
    }
  } catch (err) {
    if (reserved) {
      await reservationService.release(signalId).catch((releaseErr) =>
        log.warn({ err: releaseErr, moveId: move.id, signalId }, 'failed to release reservation after pipeline error'),
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err, moveId: move.id }, 'reservation or enqueue failed');
    const mappedReason = mapReservationError(msg);
    if (mappedReason) return mappedReason;
    if (msg === 'real_trading_disabled') {
      return 'Trading réel désactivé';
    }
    if (msg === 'sim_copy_trading_disabled') {
      return 'Copy trading sim désactivé (config)';
    }
    if (msg === 'real_copy_trading_disabled') {
      return 'Copy trading réel désactivé (config)';
    }
    if (msg === 'insufficient_cash') {
      return 'Cash simulation insuffisant';
    }
    if (reserved) {
      log.warn({ err, moveId: move.id, signalId }, 'enqueue failed after reservation — releasing and rethrowing for retry');
      throw err;
    }
    return 'Échec de la réservation';
  }

  return null;
}

function mapReservationError(message: string): string | null {
  switch (message) {
    case 'max_open_positions':
      return 'Nombre max de positions ouvertes atteint';
    case 'max_position_size':
      return 'Taille de position max dépassée';
    case 'max_exposure':
      return 'Exposition max dépassée';
    case 'position_already_active':
      return 'Position déjà ouverte';
    case 'no_open_position':
      return 'Aucune position ouverte à augmenter';
    default:
      return null;
  }
}

function applyMomentumGate(params: {
  move: MoveEventDto;
  copyConfig: CopyConfig;
  mode: TradingMode;
  entryAskVwap: number;
}): string | null {
  const { move, copyConfig, mode, entryAskVwap } = params;
  const enabled = getCopyMomentumFilterEnabled(copyConfig, mode);
  const decision = evaluateMomentumEntry(
    entryAskVwap,
    move.traderAvgPrice,
    enabled,
  );

  if (decision === 'block') {
    log.warn(
      {
        momentumDecision: decision,
        moveId: move.id,
        mode,
        assetId: move.assetId,
        entryAskVwap,
        traderAvgPrice: move.traderAvgPrice,
        ratio:
          move.traderAvgPrice > 0 ? entryAskVwap / move.traderAvgPrice : null,
      },
      'entry blocked — price below trader average (momentum filter)',
    );
    return 'Entrée refusée — prix sous le niveau moyen du trader';
  }

  if (decision === 'skip_no_avg' && enabled) {
    log.info(
      { momentumDecision: decision, moveId: move.id, mode, assetId: move.assetId },
      'momentum filter skipped — no trader avg price (fail-open)',
    );
  }

  return null;
}

function computeEntrySignalScore(
  move: MoveEventDto,
  market: Market | undefined,
  askVwap: number,
  bidVwap: number,
): SignalScore {
  const currentSpread = Math.max(0, askVwap - bidVwap);
  const hoursToExpiry = market?.endDate
    ? (market.endDate.getTime() - Date.now()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  return computeSignalScore({
    event: move,
    market: market ?? new Market(),
    currentSpread,
    hoursToExpiry,
  });
}
