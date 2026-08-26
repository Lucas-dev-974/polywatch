import {
  marketClassifier,
  parseCryptoUpDownQuestion,
  extractStartDateFromQuestion,
} from '@polywatch/core/market-list';
import type { MarketChartContext, MarketChartPosition } from './market-chart';
import type { Position } from './position';
import { investedAmount } from './position';

/** Up/Down detection via question only (Gamma tag slugs are 5M, crypto, etc.). */
export function isPositionUpDownMarket(pos: Position): boolean {
  return marketClassifier.classifyCryptoCategory(pos.marketQuestion) === 'up-down';
}

const GENERIC_INTERVAL_PLACEHOLDER = '\u2014';

function normalizeInterval(raw: string | null | undefined): string | null {
  if (!raw || raw === GENERIC_INTERVAL_PLACEHOLDER) return null;
  return raw;
}

/** Cost basis per share (entry price + fees/qty) for percent SL/TP overlays. */
export function positionCostPerShare(pos: Position): number {
  const qty = positionChartQuantity(pos) ?? 0;
  const invested = pos.entryInvestedAmount != null && pos.entryInvestedAmount > 0
    ? pos.entryInvestedAmount
    : investedAmount(pos);
  if (qty > 0) return invested / qty;
  return pos.entryPrice ?? 0;
}

export function positionToChartPosition(pos: Position): MarketChartPosition {
  return {
    id: pos.id,
    outcome: pos.outcome,
    mode: pos.mode,
    status: pos.status,
    assetId: pos.assetId,
    entryPrice: pos.entryPrice,
    entryBidVwap: pos.entryBidVwap ?? 0,
    costPerShare: positionCostPerShare(pos),
    slPercent: pos.slPercent ?? null,
    tpPercent: pos.tpPercent ?? null,
    exitBidVwap: pos.exitBidVwap ?? null,
    openedAt: pos.openedAt,
    closedAt: pos.closedAt,
    positionQuantity: positionChartQuantity(pos),
  };
}

export function positionToMarketChartContext(
  pos: Position,
): MarketChartContext | null {
  if (!pos.conditionId) return null;

  const chartPos = positionToChartPosition(pos);
  const ctx: MarketChartContext = {
    conditionId: pos.conditionId,
    copiedPositionId: pos.id,
    chartPositions: [chartPos],
    assetId: pos.assetId,
    question: pos.marketQuestion,
    marketStartAt: extractStartDateFromQuestion(pos.marketQuestion),
    marketEndAt: pos.marketEndDate,
    entryBidVwap: pos.entryBidVwap,
    entryPrice: pos.entryPrice,
    costPerShare: positionCostPerShare(pos),
    slPercent: pos.slPercent,
    tpPercent: pos.tpPercent,
    openedAt: pos.openedAt,
    closedAt: pos.closedAt,
    outcome: pos.outcome,
    exitBidVwap: pos.exitBidVwap,
    positionQuantity: positionChartQuantity(pos),
  };

  if (isPositionUpDownMarket(pos)) {
    const parsed = parseCryptoUpDownQuestion(pos.marketQuestion);
    ctx.cryptoSymbol = parsed?.cryptoSymbol ?? null;
    ctx.interval = normalizeInterval(parsed?.interval);
  } else {
    ctx.cryptoSymbol = null;
    ctx.interval = null;
  }

  return ctx;
}

/**
 * Shares held or filled at entry — for MOS comparison in the chart dialog.
 */
export function positionChartQuantity(pos: Position): number | null {
  const openQty = pos.quantity > 0 ? pos.quantity : null;
  const filled = pos.entryQuantityFilled;
  if (openQty != null) return openQty;
  if (filled != null && filled > 0) return filled;
  return null;
}
