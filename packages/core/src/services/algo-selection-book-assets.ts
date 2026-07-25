import type { DataSource } from 'typeorm';
import { createAlgoSelectionServices } from './algo-services.js';
import { isTradableAlgoMarket } from './algo-market-selection.service.js';

export interface BookAssetMaps {
  assetIds: string[];
  conditionIdByAssetId: Map<string, string>;
  outcomeByAssetId: Map<string, string>;
}

const EMPTY_MAPS: BookAssetMaps = {
  assetIds: [],
  conditionIdByAssetId: new Map(),
  outcomeByAssetId: new Map(),
};

/**
 * Resolve CLOB asset ids for enabled algo market selections from the DB.
 * Used by the worker to subscribe WS books on the same markets crypto-algo evaluates.
 */
export async function loadAlgoSelectionBookAssets(
  ds: DataSource,
  now: Date = new Date(),
): Promise<BookAssetMaps> {
  const { selectionService, marketService } = createAlgoSelectionServices(ds);
  const selections = await selectionService.loadAllEnabled();
  if (selections.length === 0) return EMPTY_MAPS;

  const markets = await marketService.loadByConditionIds(
    selections.map((s) => s.conditionId),
  );

  const assetIds: string[] = [];
  const conditionIdByAssetId = new Map<string, string>();
  const outcomeByAssetId = new Map<string, string>();

  for (const sel of selections) {
    const market = markets.get(sel.conditionId);
    if (!market || !isTradableAlgoMarket(market, now)) continue;
    if (!market.tokenIdYes || !market.tokenIdNo) continue;

    assetIds.push(market.tokenIdYes, market.tokenIdNo);
    conditionIdByAssetId.set(market.tokenIdYes, sel.conditionId);
    conditionIdByAssetId.set(market.tokenIdNo, sel.conditionId);
    outcomeByAssetId.set(market.tokenIdYes, 'up');
    outcomeByAssetId.set(market.tokenIdNo, 'down');
  }

  return { assetIds, conditionIdByAssetId, outcomeByAssetId };
}

/** Merge multiple book-asset maps (later entries override on key collision). */
export function mergeBookAssetMaps(...sources: BookAssetMaps[]): BookAssetMaps {
  const assetIdSet = new Set<string>();
  const conditionIdByAssetId = new Map<string, string>();
  const outcomeByAssetId = new Map<string, string>();

  for (const src of sources) {
    for (const id of src.assetIds) assetIdSet.add(id);
    for (const [k, v] of src.conditionIdByAssetId) conditionIdByAssetId.set(k, v);
    for (const [k, v] of src.outcomeByAssetId) outcomeByAssetId.set(k, v);
  }

  return {
    assetIds: [...assetIdSet],
    conditionIdByAssetId,
    outcomeByAssetId,
  };
}
