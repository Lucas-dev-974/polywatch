import type { IPolymarketConnectionManager } from '../worker-shared/connection-manager-interface.js';
import {
  ENTRY_MOS_SKIP_CANNOT_BUMP,
  ENTRY_MOS_SKIP_NO_LIQUIDITY_BUMP,
  effectiveEntryMos,
  ensureEntryQuantityMeetsMos,
} from './entry-mos.js';
import {
  resolveEntryMinOrderSharesDetailed,
  type ClobMarketInfoLookup,
} from './resolve-entry-mos.js';

export interface ApplyEntryMosGateParams {
  targetQty: number;
  askVwap: number;
  cash: number;
  maxPositionSizeUsdc: number;
  conditionId: string;
  assetId: string;
  clobApi: string;
  connectionManager: Pick<IPolymarketConnectionManager, 'fetchExecutablePrices'>;
  getClobMarketInfo?: ClobMarketInfoLookup;
}

export type ApplyEntryMosGateResult =
  | { ok: true; quantity: number; askVwap: number; bumped: boolean; effectiveMos: number }
  | { ok: false; skipReason: string };

/**
 * Ensure entry quantity meets market MOS (bump when possible), re-fetching
 * ask VWAP after a bump so reservation notional matches executable depth.
 */
export async function applyEntryMosGate(
  params: ApplyEntryMosGateParams,
): Promise<ApplyEntryMosGateResult> {
  const detailed = await resolveEntryMinOrderSharesDetailed({
    conditionId: params.conditionId,
    assetId: params.assetId,
    clobApi: params.clobApi,
    getClobMarketInfo: params.getClobMarketInfo,
  });
  const effectiveMos = effectiveEntryMos(detailed);

  const gate = ensureEntryQuantityMeetsMos({
    targetQty: params.targetQty,
    effectiveMos,
    askVwap: params.askVwap,
    cash: params.cash,
    maxPositionSizeUsdc: params.maxPositionSizeUsdc,
  });

  if (!gate.ok) {
    return { ok: false, skipReason: ENTRY_MOS_SKIP_CANNOT_BUMP };
  }

  let finalQty = gate.quantity;
  let finalAskVwap = params.askVwap;

  if (gate.bumped) {
    const bumpedPrices = await params.connectionManager.fetchExecutablePrices(
      params.assetId,
      finalQty,
    );
    if (bumpedPrices.executableAskVwap <= 0) {
      return { ok: false, skipReason: ENTRY_MOS_SKIP_NO_LIQUIDITY_BUMP };
    }
    finalAskVwap = bumpedPrices.executableAskVwap;

    const bumpedNotional = finalQty * finalAskVwap;
    if (
      bumpedNotional > params.cash + 1e-9 ||
      bumpedNotional > params.maxPositionSizeUsdc + 1e-9
    ) {
      return { ok: false, skipReason: ENTRY_MOS_SKIP_CANNOT_BUMP };
    }
  }

  return {
    ok: true,
    quantity: finalQty,
    askVwap: finalAskVwap,
    bumped: gate.bumped,
    effectiveMos,
  };
}
