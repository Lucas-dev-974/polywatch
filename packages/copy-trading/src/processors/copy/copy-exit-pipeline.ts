import {
  computeSellQuantity,
  hashCopyOrderSignalId,
  type IPolymarketConnectionManager,
  type MoveEventDto,
  type OrderSignal,
  type RedisQueue,
  type TradingMode,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { findOpenPosition } from './copy-position-lookup.js';
import type { WatchlistEntry } from './copy-risk-gate.js';
import { resolveMinOrderShares } from '../../clob/min-order-shares.js';

const log = pino({ name: 'copy-exit-pipeline' });

/** Dedupe window for copy SELL signals — prevents double enqueue on C1 move retries. */
const COPY_EXIT_DEDUPE_TTL_SECONDS = 120;

export async function runCopyExitPipeline(params: {
  ds: DataSource;
  move: MoveEventDto;
  entry: WatchlistEntry;
  mode: TradingMode;
  connectionManager: IPolymarketConnectionManager;
  orderQueue: RedisQueue<OrderSignal>;
}): Promise<string | null> {
  const { ds, move, entry, mode, connectionManager, orderQueue } = params;

  const pos = await findOpenPosition(
    ds,
    entry.id,
    move.conditionId,
    move.assetId,
    mode,
  );
  if (!pos) {
    return 'Aucune position ouverte à fermer';
  }

  const sellQty = computeSellQuantity(
    move.type,
    pos.quantity,
    move.previousTraderSize - move.traderSize,
    move.previousTraderSize,
  );
  if (sellQty <= 0) {
    return 'Quantité de sortie nulle';
  }

  if (move.type === 'DECREASED') {
    const minShares = await resolveMinOrderShares({
      conditionId: move.conditionId,
      assetId: move.assetId,
    });
    if (sellQty < minShares) {
      log.warn(
        {
          moveId: move.id,
          assetId: move.assetId,
          sellQty,
          minShares,
        },
        'partial exit skipped — sell quantity below market minimum order size',
      );
      return 'Quantité de sortie sous le minimum marché';
    }
  }

  let bidVwap: number;
  try {
    const prices = await connectionManager.fetchExecutablePrices(
      move.assetId,
      sellQty,
    );
    bidVwap = prices.executableBidVwap;
  } catch (err) {
    log.warn(
      { err, moveId: move.id, assetId: move.assetId, sellQty },
      'exit skipped — failed to fetch executable prices',
    );
    return 'Échec récupération prix de sortie';
  }

  const reason = move.type === 'CLOSED' ? 'COPY_CLOSE' : 'COPY_DECREASE';
  const signalId = hashCopyOrderSignalId({
    moveEventId: move.id,
    mode,
    reason,
    side: 'SELL',
  });

  const job: OrderSignal = {
    id: signalId,
    copiedPositionId: pos.id,
    conditionId: move.conditionId,
    assetId: move.assetId,
    side: 'SELL',
    quantity: sellQty,
    orderType: 'FAK',
    referenceVwap: bidVwap,
    reason,
    mode,
  };

  const enqueued = await orderQueue.enqueueUnique(
    job,
    signalId,
    COPY_EXIT_DEDUPE_TTL_SECONDS,
  );
  if (!enqueued) {
    log.info(
      { moveId: move.id, signalId, mode, reason },
      'copy exit signal already queued — skipping duplicate enqueue',
    );
  }

  return null;
}
