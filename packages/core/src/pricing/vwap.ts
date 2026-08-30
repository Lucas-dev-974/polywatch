import type { LiquidityStatus, OrderBook, OrderBookLevel } from '../types/index.js';

export interface VwapResult {
  vwap: number;
  filledQuantity: number;
  liquidityStatus: LiquidityStatus;
}

function walkBook(
  levels: OrderBookLevel[],
  quantity: number,
  ascending: boolean,
): VwapResult {
  const sorted = [...levels].sort((a, b) =>
    ascending ? a.price - b.price : b.price - a.price,
  );

  let remaining = quantity;
  let totalProceeds = 0;

  for (const level of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(level.size, remaining);
    totalProceeds += take * level.price;
    remaining -= take;
  }

  const filledQuantity = quantity - remaining;

  if (filledQuantity === 0) {
    return { vwap: 0, filledQuantity: 0, liquidityStatus: 'illiquid' };
  }

  if (remaining > 0) {
    return {
      vwap: totalProceeds / filledQuantity,
      filledQuantity,
      liquidityStatus: 'partial',
    };
  }

  return {
    vwap: totalProceeds / quantity,
    filledQuantity: quantity,
    liquidityStatus: 'ok',
  };
}

export function computeExecutableBidVwap(
  orderBook: Pick<OrderBook, 'bids'>,
  quantity: number,
): VwapResult {
  return walkBook(orderBook.bids, quantity, false);
}

export function computeExecutableAskVwap(
  orderBook: Pick<OrderBook, 'asks'>,
  quantity: number,
): VwapResult {
  return walkBook(orderBook.asks, quantity, true);
}

export interface FakFillResult {
  fillQuantity: number;
  vwap: number;
  /** pUSD spent. Set by collateral BUY walks; omitted for share-qty walks. */
  spentPusd?: number;
}

/**
 * Simulate a CLOB Fill-And-Kill match: consume levels priced at-or-better
 * than `limitPrice` (asks ≤ limit for BUY, bids ≥ limit for SELL) up to
 * `quantity`. The unfilled remainder is cancelled, exactly like a FAK order —
 * the fill can therefore be partial or empty when depth at the limit price
 * is insufficient. Callers that model live CLOB FAK (`order couldn't be fully
 * filled` / `no orders found to match with fak`) should treat a partial or
 * empty result as `order_not_matched`, not as a phantom fill.
 */
export function simulateFakFill(
  levels: OrderBookLevel[],
  quantity: number,
  limitPrice: number,
  side: 'BUY' | 'SELL',
): FakFillResult {
  const ascending = side === 'BUY';
  const sorted = [...levels].sort((a, b) =>
    ascending ? a.price - b.price : b.price - a.price,
  );

  let remaining = quantity;
  let totalProceeds = 0;

  for (const level of sorted) {
    if (remaining <= 0) break;
    const withinLimit =
      side === 'BUY' ? level.price <= limitPrice : level.price >= limitPrice;
    if (!withinLimit) break;
    const take = Math.min(level.size, remaining);
    totalProceeds += take * level.price;
    remaining -= take;
  }

  const fillQuantity = quantity - remaining;
  return {
    fillQuantity,
    vwap: fillQuantity > 0 ? totalProceeds / fillQuantity : 0,
  };
}

/**
 * Simulate a live CLOB BUY FAK whose `amount` is collateral (pUSD), not
 * shares. Resting asks at-or-below `limitPrice` are consumed until the
 * budget is spent. When the fill price is below the (padded) limit, share
 * quantity can exceed the requested size — the same overfill live parse
 * reports as takingAmount / makingAmount.
 */
export function simulateFakBuyCollateralFill(
  levels: OrderBookLevel[],
  budgetPusd: number,
  limitPrice: number,
): FakFillResult {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  let remainingBudget = budgetPusd;
  let fillQuantity = 0;
  let totalSpent = 0;

  for (const level of sorted) {
    if (remainingBudget <= 1e-12) break;
    if (level.price > limitPrice) break;
    if (!(level.price > 0) || !(level.size > 0)) continue;
    const take = Math.min(level.size, remainingBudget / level.price);
    if (take <= 0) break;
    const cost = take * level.price;
    fillQuantity += take;
    totalSpent += cost;
    remainingBudget -= cost;
  }

  return {
    fillQuantity,
    vwap: fillQuantity > 0 ? totalSpent / fillQuantity : 0,
    spentPusd: totalSpent,
  };
}

export function triggerPnlPercent(
  executableBidVwap: number,
  entryBidVwap: number,
): number {
  if (entryBidVwap === 0) {
    // Can't compute market-move PnL without entry bid — caller should fall
    // back to closure-based evaluation (SL-6). A sentinel of 0 is safe
    // because it won't trigger SL/TP accidentally.
    return 0;
  }
  return ((executableBidVwap - entryBidVwap) / entryBidVwap) * 100;
}

/** Mark-to-market PnL: (bid - costBasis) * qty - remaining entry fees. Cost basis is entry ask (copy/crypto) or entry bid (weather, via unrealizedPnlEntryBasis). */
export function unrealizedPnl(
  executableBidVwap: number,
  entryPrice: number,
  quantity: number,
  entryFeesRemaining = 0,
): number {
  return (
    executableBidVwap * quantity -
    entryPrice * quantity -
    entryFeesRemaining
  );
}

/**
 * Closure PnL percent including entry fees — used for percent SL/TP/trailing.
 *
 * The cost basis per share is `entryPrice + entryFeesRemaining / entryQuantityRemaining`,
 * so a SL of -100% means "lose at most the capital invested" (price paid + entry fees).
 * Exit fees are not anticipated here because the SL decision is taken before the sell.
 */
export function closurePnlPercent(
  executableBidVwap: number,
  entryPrice: number,
  entryFeesRemaining = 0,
  entryQuantityRemaining = 0,
): number {
  if (entryPrice === 0) return 0;
  const costBasisPerShare =
    entryQuantityRemaining > 0
      ? entryPrice + entryFeesRemaining / entryQuantityRemaining
      : entryPrice;
  return ((executableBidVwap - costBasisPerShare) / costBasisPerShare) * 100;
}
