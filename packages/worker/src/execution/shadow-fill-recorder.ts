import type { DataSource } from 'typeorm';
import type { OrderBook, OrderSignal } from '@polywatch/core';
import { ShadowFill, simulateFakFill } from '@polywatch/core';
import pino from 'pino';

const log = pino({ name: 'shadow-fill-recorder' });

function deltaPct(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : 100;
  return ((actual - expected) / expected) * 100;
}

export async function recordShadowFill(
  ds: DataSource,
  signal: OrderSignal,
  limitPrice: number,
  realFillPrice: number,
  realFillQty: number,
  book: OrderBook | undefined,
): Promise<void> {
  if (!book) return;

  const levels = signal.side === 'BUY' ? book.asks : book.bids;
  const fak = simulateFakFill(levels, signal.quantity, limitPrice, signal.side);

  try {
    await ds.getRepository(ShadowFill).insert({
      signalId: signal.id,
      assetId: signal.assetId,
      side: signal.side,
      limitPrice,
      realFillPrice,
      realFillQty,
      simFillPrice: fak.vwap,
      simFillQty: fak.fillQuantity,
      priceDeltaPct: deltaPct(realFillPrice, fak.vwap),
      qtyDeltaPct: deltaPct(realFillQty, fak.fillQuantity),
    });
  } catch (err) {
    log.warn({ err, signalId: signal.id }, 'shadow fill insert failed');
  }
}
