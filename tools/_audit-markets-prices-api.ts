import {
  createDataSource,
  initializeDataSource,
  AlgoAutoTrackService,
  createAlgoSelectionServices,
} from '@polywatch/core';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

async function main() {
  const ds = await initializeDataSource(createDataSource());
  const { selectionService } = createAlgoSelectionServices(ds);
  const autoTrackService = new AlgoAutoTrackService(ds);

  const sync = await autoTrackService.syncMarketSelectionsIfNeeded(selectionService);
  console.log('SYNC', sync);

  const selections = await selectionService.loadAllEnabled();
  console.log(`LIVE SELECTIONS: ${selections.length}`);
  for (const s of selections) {
    console.log(`  - ${s.cryptoSymbol} ${s.interval}: ${s.question}`);
  }

  const liveConditionIdsByRule = new Map<string, string | null>();
  for (const sel of selections) {
    if (!sel.cryptoSymbol || !sel.interval) continue;
    liveConditionIdsByRule.set(`${sel.cryptoSymbol}:${sel.interval}`, sel.conditionId);
  }

  const futureMarkets = await autoTrackService.discoverFutureMarketsForRulesThrottled(
    liveConditionIdsByRule,
    { force: true },
  );
  console.log(`\nFUTURE DISCOVERED (before filter): ${futureMarkets.length}`);
  for (const m of futureMarkets) {
    console.log(`  - ${m.cryptoSymbol} ${m.interval}: ${m.question} start=${m.startDate}`);
  }

  const now = Date.now();
  const filtered = futureMarkets.filter((m) => {
    if (!m.startDate) return false;
    const startMs = new Date(m.startDate).getTime();
    const delta = startMs - now;
    return delta >= 0 && delta <= 10 * 60 * 1000;
  });
  console.log(`\nFUTURE AFTER 10min FILTER: ${filtered.length}`);
  for (const m of filtered) {
    const delta = Math.round((new Date(m.startDate!).getTime() - now) / 1000);
    console.log(`  - ${m.cryptoSymbol}: starts in ${delta}s — ${m.question}`);
  }

  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
