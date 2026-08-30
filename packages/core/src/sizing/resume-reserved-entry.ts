import type { IPolymarketConnectionManager } from '../worker-shared/connection-manager-interface.js';
import type { RedisQueue } from '../worker-shared/redis-queue.js';
import type { ReservationService, ReserveResult } from '../services/reservation.service.js';
import type { OrderReason, OrderSignal, TradingMode } from '../types/index.js';
import { MIN_ORDER_SHARES, MIN_ORDER_PUSD } from './constants.js';
import { shouldSkipNoLiquidityAsk } from './entry-ask-sanity.js';
import { ENTRY_MOS_SKIP_CANNOT_BUMP } from './entry-mos.js';
import { enqueueEntrySignal } from './enqueue-entry-signal.js';
import { resolveEntryEnqueueBlocked } from './entry-enqueue-result.js';
import { fetchEntryAskLiquidityWithRetries } from './entry-depth-retry.js';

export type EntryOpenReason = Extract<
  OrderReason,
  'COPY_OPEN' | 'COPY_INCREASE' | 'ALGO_OPEN' | 'WEATHER_OPEN'
>;

export type ResolveEffectiveEntryMos = (input: {
  conditionId: string;
  assetId: string;
}) => Promise<number>;

export interface ResumeReservedEntryParams {
  conditionId: string;
  assetId: string;
  mode: TradingMode;
  /** Position-specific order signal id used as job.id and execution claim key. */
  signalId: string;
  /** Dedupe key for enqueueUnique; defaults to signalId (copy-trading). */
  logicalKey?: string;
  reason: EntryOpenReason;
  reservation: ReserveResult;
  connectionManager: Pick<IPolymarketConnectionManager, 'fetchExecutablePrices'> & {
    forceRefreshBook?(assetId: string): Promise<unknown>;
  };
  reservationService: ReservationService;
  orderQueue: RedisQueue<OrderSignal>;
  resolveEffectiveEntryMos?: ResolveEffectiveEntryMos;
  hasBuyExecution?: () => Promise<boolean>;
  hasInFlightBuy?: () => Promise<boolean>;
  /** Extra ticks added to the FAK limit price on entry (taker aggressiveness). */
  entryTickPad?: number;
  /** Min ask depth (shares) for the depth gate; order qty is unchanged. 0 = disabled. */
  minAskDepthShares?: number;
  /**
   * When false, skip reasons leave the reservation in place. The pending-entry
   * janitor must not cancel an in-flight weather/algo entry that may still fill.
   * Default true (pipeline resume may abandon a dead reservation).
   */
  releaseOnSkip?: boolean;
}

/**
 * Re-enqueue a BUY after a transient failure once `ReservationService.reserve`
 * already succeeded. Quantity is derived from the reserved notional so
 * exposure accounting stays aligned with the reservation row.
 */
export async function resumeEntryFromReservation(
  params: ResumeReservedEntryParams,
): Promise<string | null> {
  const {
    conditionId,
    assetId,
    mode,
    signalId,
    logicalKey = signalId,
    reason,
    reservation,
    connectionManager,
    reservationService,
    orderQueue,
    resolveEffectiveEntryMos,
    hasBuyExecution,
    hasInFlightBuy,
    entryTickPad,
    minAskDepthShares,
    releaseOnSkip = true,
  } = params;
  const { reservedNotionalPusd, reservationId, copiedPositionId } = reservation;

  const deferToWorker = async (): Promise<null> => {
    return null;
  };

  const abandon = async (skipReason: string): Promise<string | null> => {
    if (hasInFlightBuy && (await hasInFlightBuy())) {
      return deferToWorker();
    }
    if (!releaseOnSkip) {
      return skipReason;
    }
    await reservationService
      .release(signalId, `resume_abandoned:${skipReason}`)
      .catch(() => undefined);
    return skipReason;
  };

  const roughPrices = await connectionManager.fetchExecutablePrices(assetId, 1);
  if (
    shouldSkipNoLiquidityAsk({
      askVwap: roughPrices.executableAskVwap,
      notionalPusd: reservedNotionalPusd,
      askLiquidityStatus: roughPrices.askLiquidityStatus,
      liquidityStatus: roughPrices.liquidityStatus,
    })
  ) {
    return abandon('no_liquidity');
  }

  const estimatedQty = reservedNotionalPusd / roughPrices.executableAskVwap;
  const depthTargetQty = Math.max(
    estimatedQty,
    typeof minAskDepthShares === 'number' && minAskDepthShares > 0
      ? minAskDepthShares
      : 0,
  );
  const depthResult = await fetchEntryAskLiquidityWithRetries({
    assetId,
    targetQty: depthTargetQty,
    maxRetries: 1,
    delayMs: 250,
    connectionManager,
  });
  if (!depthResult.ok) {
    return abandon(depthResult.skipReason);
  }
  const entryAskVwap = depthResult.prices.executableAskVwap;

  const targetQty = reservedNotionalPusd / entryAskVwap;
  if (
    shouldSkipNoLiquidityAsk({
      askVwap: entryAskVwap,
      notionalPusd: reservedNotionalPusd,
      impliedQty: targetQty,
      askLiquidityStatus: depthResult.prices.askLiquidityStatus,
      liquidityStatus: depthResult.prices.liquidityStatus,
    })
  ) {
    return abandon('no_liquidity');
  }
  if (targetQty < MIN_ORDER_SHARES) {
    return abandon('Quantit� r�serv�e inf�rieure au minimum');
  }
  if (mode === 'real' && reservedNotionalPusd < MIN_ORDER_PUSD) {
    return abandon(
      `Montant r�serv� inf�rieur au minimum live (${MIN_ORDER_PUSD} pUSD)`,
    );
  }

  if (resolveEffectiveEntryMos) {
    const effectiveMos = await resolveEffectiveEntryMos({ conditionId, assetId });
    if (targetQty < effectiveMos) {
      return abandon(ENTRY_MOS_SKIP_CANNOT_BUMP);
    }
  }

  const ttlSeconds = Math.max(
    1,
    Math.ceil((reservation.expiresAt.getTime() - Date.now()) / 1000),
  );
  const enqueued = await enqueueEntrySignal({
    orderQueue,
    dedupeKey: logicalKey,
    ttlSeconds,
    hasBuyExecution,
    hasInFlightBuy,
    job: {
      id: signalId,
      copiedPositionId,
      reservationId,
      conditionId,
      assetId,
      side: 'BUY',
      quantity: targetQty,
      pusdAmount: reservedNotionalPusd,
      orderType: reason === 'ALGO_OPEN' ? 'FOK' : 'FAK',
      referenceVwap: entryAskVwap,
      reason,
      mode,
      entryTickPad,
    },
  });

  const blocked = await resolveEntryEnqueueBlocked({
    enqueued,
    orderQueue,
    dedupeKey: logicalKey,
    orderSignalId: signalId,
    reservationService,
    hasBuyExecution,
    hasInFlightBuy,
    blockedReason: 'Enqueue file bloqué (reprise)',
    releaseOnBlock: releaseOnSkip,
  });
  if (blocked) return blocked;

  return null;
}
