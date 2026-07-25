import type { AlgoAutoTrackService } from '@polywatch/core';
import type { SelectionLoader } from './selection-loader.js';
import type { WatchedMarketInput } from './market-surveillance-recorder.js';

export async function buildSurveillanceTargets(
  autoTrackService: AlgoAutoTrackService,
  selectionLoader: SelectionLoader,
): Promise<WatchedMarketInput[]> {
  const enabledRules = await autoTrackService.loadAllEnabled();
  if (enabledRules.length === 0) return [];

  const selections = selectionLoader.getActiveSelections().filter((s) => s.enabled);
  const liveConditionIdsByRule = new Map<string, string | null>();
  for (const sel of selections) {
    if (!sel.cryptoSymbol || !sel.interval) continue;
    liveConditionIdsByRule.set(`${sel.cryptoSymbol}:${sel.interval}`, sel.conditionId);
  }

  const futureMarkets = await autoTrackService.discoverFutureMarketsForRulesThrottled(
    liveConditionIdsByRule,
  );

  const byConditionId = new Map<string, WatchedMarketInput>();
  for (const sel of selections) {
    byConditionId.set(sel.conditionId, sel);
  }
  for (const market of futureMarkets) {
    if (!byConditionId.has(market.conditionId)) {
      byConditionId.set(market.conditionId, market);
    }
  }

  return [...byConditionId.values()];
}
