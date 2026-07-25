import type { IPolymarketConnectionManager } from '../worker-shared/connection-manager-interface.js';
import { fetchEntryAskLiquidityWithRetries } from './entry-depth-retry.js';
import { effectiveEntryMos } from './entry-mos.js';
import { resolveEntryMinOrderSharesDetailed } from './resolve-entry-mos.js';

/** Upstream ask-depth gate before reserving capital for an algo entry. */
export async function gateAlgoEntryAskLiquidity(params: {
  conditionId: string;
  assetId: string;
  connectionManager: Pick<IPolymarketConnectionManager, 'fetchExecutablePrices'> & {
    forceRefreshBook?(assetId: string): Promise<unknown>;
  };
  clobApi: string;
  /** Retries after the first depth check (default 1 = 2 attempts). */
  maxRetries?: number;
  delayMs?: number;
}): Promise<string | null> {
  const detailed = await resolveEntryMinOrderSharesDetailed({
    conditionId: params.conditionId,
    assetId: params.assetId,
    clobApi: params.clobApi,
  });
  const mosQty = effectiveEntryMos(detailed);
  const depth = await fetchEntryAskLiquidityWithRetries({
    assetId: params.assetId,
    targetQty: mosQty,
    maxRetries: params.maxRetries ?? 1,
    delayMs: params.delayMs ?? 250,
    connectionManager: params.connectionManager,
  });
  if (!depth.ok) {
    return depth.skipReason;
  }
  return null;
}
