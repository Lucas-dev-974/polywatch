export interface SellSettlement {
  feeAlloc: number;
  exitFees: number;
  realizedPnl: number;
  cashCredit: number;
}

export interface SimExecutionCashRow {
  copiedPositionId: number;
  side: 'BUY' | 'SELL';
  reason: string | null;
  fillPrice: number;
  fillQuantity: number;
  fees: number;
}

export const FILLED_BUY_EXEC_STATUSES = ['filled', 'partial', 'no_payout'] as const;

export interface EntryInvestedSnapshot {
  quantity: number;
  amount: number;
}

export interface BuyExecutionInvestedRow {
  side: string;
  status?: string | null;
  fillPrice?: number | null;
  fillQuantity?: number | null;
  fees?: number | null;
}

/** Total entry cost (price × qty + fees) from filled BUY executions. */
export function computeEntryInvestedFromBuyExecutions(
  executions: BuyExecutionInvestedRow[],
): EntryInvestedSnapshot {
  let quantity = 0;
  let amount = 0;
  for (const ex of executions) {
    if (ex.side !== 'BUY') continue;
    if (
      ex.status != null &&
      !FILLED_BUY_EXEC_STATUSES.includes(
        ex.status as (typeof FILLED_BUY_EXEC_STATUSES)[number],
      )
    ) {
      continue;
    }
    const qty = ex.fillQuantity ?? 0;
    const price = ex.fillPrice ?? 0;
    if (qty <= 0) continue;
    quantity += qty;
    amount += computeBuyCashDebit(price, qty, ex.fees ?? 0);
  }
  return { quantity, amount };
}

interface PositionCostState {
  entryPrice: number;
  entryFeesRemaining: number;
  entryQuantityRemaining: number;
}

/** Net cash delta from sim executions relative to baseline (buys negative, sells positive). */
export function replaySimCashDelta(executions: SimExecutionCashRow[]): number {
  const positionState = new Map<number, PositionCostState>();
  let netCash = 0;

  for (const ex of executions) {
    const price = ex.fillPrice;
    const qty = ex.fillQuantity;
    if (qty <= 0) continue;

    if (ex.side === 'BUY') {
      netCash -= computeBuyCashDebit(price, qty, ex.fees);
      const st = positionState.get(ex.copiedPositionId);
      if (!st) {
        positionState.set(ex.copiedPositionId, {
          entryPrice: price,
          entryFeesRemaining: ex.fees,
          entryQuantityRemaining: qty,
        });
      } else {
        const oldQty = st.entryQuantityRemaining;
        st.entryPrice = (oldQty * st.entryPrice + qty * price) / (oldQty + qty);
        st.entryFeesRemaining += ex.fees;
        st.entryQuantityRemaining += qty;
      }
      continue;
    }

    const st = positionState.get(ex.copiedPositionId);
    const qtyRemaining = st?.entryQuantityRemaining ?? 0;
    const sellQty = Math.min(qty, qtyRemaining);
    if (sellQty <= 0) continue;

    const settlement = computeSellSettlement({
      isRedemption: ex.reason === 'REDEMPTION',
      fillPrice: price,
      fillQuantity: sellQty,
      inputFees: ex.fees * (sellQty / qty),
      entryPrice: st?.entryPrice ?? 0,
      entryFeesRemaining: st?.entryFeesRemaining ?? 0,
      entryQuantityRemaining: qtyRemaining,
    });
    netCash += settlement.cashCredit;
    if (st) {
      st.entryFeesRemaining -= settlement.feeAlloc;
      st.entryQuantityRemaining = Math.max(0, qtyRemaining - sellQty);
    }
  }

  return netCash;
}

export function computeBuyCashDebit(
  fillPrice: number,
  fillQuantity: number,
  fees: number,
): number {
  return fillPrice * fillQuantity + fees;
}

export function computeSellSettlement(input: {
  isRedemption: boolean;
  fillPrice: number;
  fillQuantity: number;
  inputFees: number;
  entryPrice: number;
  entryFeesRemaining: number;
  entryQuantityRemaining: number;
}): SellSettlement {
  const feeAlloc =
    input.entryQuantityRemaining > 0
      ? input.entryFeesRemaining *
        (input.fillQuantity / input.entryQuantityRemaining)
      : 0;
  const exitFees = input.isRedemption ? 0 : input.inputFees;
  const proceeds = input.fillPrice * input.fillQuantity;

  return {
    feeAlloc,
    exitFees,
    realizedPnl: proceeds - input.entryPrice * input.fillQuantity - exitFees - feeAlloc,
    cashCredit: proceeds - exitFees,
  };
}

export interface PreCloseSellPreviewInput {
  fillPrice: number;
  fillQuantity: number;
  exitFees: number;
  entryPrice: number;
  entryFeesRemaining: number;
  entryQuantityRemaining: number;
  quantity: number;
}

/** Projected realized PnL (USDC) if the position were sold at the given fill. */
export function previewSellRealizedPnl(input: PreCloseSellPreviewInput): number {
  const sellQty = Math.min(input.fillQuantity, input.quantity);
  if (sellQty <= 0) return 0;
  const qtyRemaining = input.entryQuantityRemaining;
  return computeSellSettlement({
    isRedemption: false,
    fillPrice: input.fillPrice,
    fillQuantity: sellQty,
    inputFees: input.exitFees,
    entryPrice: input.entryPrice,
    entryFeesRemaining: input.entryFeesRemaining,
    entryQuantityRemaining: qtyRemaining,
  }).realizedPnl;
}
