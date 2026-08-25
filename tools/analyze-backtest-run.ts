/**
 * Analyse détaillée d'une run backtest à partir du JSON extrait par
 * audit-backtest-run.ts. Produit des métriques, répartitions et détection
 * d'anomalies (zero-holding, fills hors courbe, sizing, ghost, etc.).
 *
 * Usage:
 *   npx tsx tools/analyze-backtest-run.ts tmp/run57.json
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx tools/analyze-backtest-run.ts <json>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
const run = data.run;
const positions = data.positions;
const equity = data.equity;
const excluded = data.excluded;

const params = JSON.parse(run.params_json);
const stats = JSON.parse(run.stats_json);
const warnings = JSON.parse(run.fidelity_warnings_json);
const config = JSON.parse(run.config_snapshot_json);
const strategyParams = JSON.parse(config.weatherAlgoStrategyParams || '{}');

const fmt = (n: number, d = 2) => (n == null ? '—' : n.toFixed(d));
const msToH = (ms: number) => (ms / 3_600_000).toFixed(1);

function main() {
  console.log('='.repeat(80));
  console.log(`AUDIT RUN #${run.id} — ${run.domain}/${run.mode} — engine ${run.engine_version}`);
  console.log('='.repeat(80));

  console.log('\n## 1. Contexte');
  console.log(`status=${run.status} progress=${run.progress_pct}%`);
  console.log(`label=${run.label ?? '(aucun)'}`);
  console.log(`created=${run.created_at} started=${run.started_at} finished=${run.finished_at}`);
  const durMs = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  console.log(`durée run=${(durMs / 1000).toFixed(1)}s`);
  console.log(`plage=${run.data_range_from} → ${run.data_range_to}`);
  console.log(`config_fingerprint=${run.config_fingerprint}`);
  console.log(`params=${JSON.stringify(params)}`);
  console.log(`strategyParams[${params.strategyId}]=${JSON.stringify(strategyParams[params.strategyId])}`);

  console.log('\n## 2. Stats globales');
  console.log(`totalPnl=${fmt(stats.totalPnl)} (${fmt(stats.pnlPct)}%)`);
  console.log(`finalEquity=${fmt(stats.finalEquity)}`);
  console.log(`maxDrawdown=${fmt(stats.maxDrawdown * 100)}%`);
  console.log(`winRate=${fmt(stats.winRate * 100)}% (${Math.round(stats.winRate * stats.totalTrades)}/${stats.totalTrades})`);
  console.log(`profitFactor=${fmt(stats.profitFactor)}`);
  console.log(`avgWin=${fmt(stats.avgWin)} avgLoss=${fmt(stats.avgLoss)} expectancy=${fmt(stats.expectancy)}`);
  console.log(`avgHoldingMs=${fmt(stats.avgHoldingMs, 0)}ms (~${msToH(stats.avgHoldingMs)}h)`);
  console.log(`byExitReason=${JSON.stringify(stats.byExitReason)}`);
  console.log(`byCity=${JSON.stringify(stats.byCity)}`);

  console.log('\n## 3. Cohérence mathématique');
  const sumPnl = positions.reduce((s: number, p: any) => s + (p.pnl ?? 0), 0);
  const sumFees = positions.reduce((s: number, p: any) => s + (p.fees ?? 0), 0);
  console.log(`somme pnl positions=${fmt(sumPnl)} vs stats.totalPnl=${fmt(stats.totalPnl)} → ${Math.abs(sumPnl - stats.totalPnl) < 0.01 ? 'OK' : '⚠️ ÉCART'}`);
  console.log(`somme fees=${fmt(sumFees)}`);
  const byReason: Record<string, { n: number; pnl: number }> = {};
  for (const p of positions) {
    const r = p.exit_reason ?? 'OPEN';
    byReason[r] = byReason[r] ?? { n: 0, pnl: 0 };
    byReason[r].n++;
    byReason[r].pnl += p.pnl ?? 0;
  }
  for (const [r, v] of Object.entries(byReason)) {
    console.log(`  ${r}: n=${v.n} pnl=${fmt(v.pnl)}`);
  }

  console.log('\n## 4. Anomalies');

  // 4a. Zero-holding / holds très courts
  const zeroHolding = positions.filter((p: any) => p.exit_at && p.entry_at === p.exit_at);
  const shortHolding = positions.filter((p: any) => {
    if (!p.exit_at) return false;
    const ms = new Date(p.exit_at).getTime() - new Date(p.entry_at).getTime();
    return ms > 0 && ms < 1000;
  });
  console.log(`\n[4a] zero-holding (entry_at===exit_at): ${zeroHolding.length}`);
  for (const p of zeroHolding) console.log(`  #${p.id} ${p.city} ${p.exit_reason} entry=${p.entry_at}`);
  console.log(`[4a] holds < 1s: ${shortHolding.length}`);
  for (const p of shortHolding) {
    const ms = new Date(p.exit_at).getTime() - new Date(p.entry_at).getTime();
    console.log(`  #${p.id} ${p.city} ${p.exit_reason} hold=${ms}ms`);
  }

  // 4b. Positions ouvertes (ghost)
  const open = positions.filter((p: any) => !p.exit_at || !p.exit_reason);
  console.log(`\n[4b] positions ouvertes (ghost): ${open.length}`);
  for (const p of open) console.log(`  #${p.id} ${p.city} entry=${p.entry_at} qty=${p.qty} entryPrice=${p.entry_price}`);

  // 4c. Sizing anormal (qty hors norme)
  const qtyCounts: Record<number, number> = {};
  for (const p of positions) qtyCounts[p.qty] = (qtyCounts[p.qty] ?? 0) + 1;
  console.log(`\n[4c] distribution qty: ${JSON.stringify(qtyCounts)}`);
  const weirdQty = positions.filter((p: any) => p.qty > 100);
  if (weirdQty.length) {
    console.log(`[4c] qty > 100 (sizing suspect): ${weirdQty.length}`);
    for (const p of weirdQty) console.log(`  #${p.id} ${p.city} qty=${p.qty} entryPrice=${p.entry_price} pnl=${fmt(p.pnl)}`);
  }

  // 4d. Fills hors courbe / prix extrêmes
  const lowEntry = positions.filter((p: any) => p.entry_price < 0.1);
  console.log(`\n[4d] entrées à prix < 0.1: ${lowEntry.length}`);
  for (const p of lowEntry) console.log(`  #${p.id} ${p.city} entryPrice=${p.entry_price} qty=${p.qty} pnl=${fmt(p.pnl)}`);

  // 4e. PnL par position extrêmes
  const sorted = [...positions].sort((a: any, b: any) => (a.pnl ?? 0) - (b.pnl ?? 0));
  console.log(`\n[4e] pires 5 positions:`);
  for (const p of sorted.slice(0, 5)) console.log(`  #${p.id} ${p.city} ${p.exit_reason} entry=${p.entry_price} exit=${p.exit_price} pnl=${fmt(p.pnl)}`);
  console.log(`[4e] meilleures 5 positions:`);
  for (const p of sorted.slice(-5).reverse()) console.log(`  #${p.id} ${p.city} ${p.exit_reason} entry=${p.entry_price} exit=${p.exit_price} pnl=${fmt(p.pnl)}`);

  // 4f. Ré-entrées sur même condition_id
  const condCounts: Record<string, number> = {};
  for (const p of positions) condCounts[p.condition_id] = (condCounts[p.condition_id] ?? 0) + 1;
  const reentries = Object.entries(condCounts).filter(([, n]) => n > 1);
  console.log(`\n[4f] condition_id avec >1 position: ${reentries.length}`);
  for (const [cid, n] of reentries) {
    const ps = positions.filter((p: any) => p.condition_id === cid);
    console.log(`  ${cid.slice(0, 20)}… n=${n} ${ps.map((p: any) => `#${p.id}@${p.entry_at.slice(11, 19)}`).join(' ')}`);
  }

  // 4g. SL immédiat (exit très proche de entry)
  const immediateSl = positions.filter((p: any) => {
    if (p.exit_reason !== 'SL' || !p.exit_at) return false;
    const ms = new Date(p.exit_at).getTime() - new Date(p.entry_at).getTime();
    return ms < 60_000;
  });
  console.log(`\n[4g] SL < 60s après entrée: ${immediateSl.length}`);
  for (const p of immediateSl) {
    const ms = new Date(p.exit_at).getTime() - new Date(p.entry_at).getTime();
    console.log(`  #${p.id} ${p.city} hold=${(ms / 1000).toFixed(0)}s entry=${p.entry_price} exit=${p.exit_price} pnl=${fmt(p.pnl)}`);
  }

  // 4h. RESOLUTION perdante (entrée puis résolution NO)
  const resLoss = positions.filter((p: any) => p.exit_reason === 'RESOLUTION' && (p.pnl ?? 0) < 0);
  console.log(`\n[4h] RESOLUTION perdantes: ${resLoss.length}`);
  for (const p of resLoss) console.log(`  #${p.id} ${p.city} entry=${p.entry_price} exit=${p.exit_price} pnl=${fmt(p.pnl)}`);

  console.log('\n## 5. Warnings de fidélité');
  for (const w of warnings) console.log(`  - ${w}`);

  console.log('\n## 6. Excluded ticks');
  const exclByReason: Record<string, number> = {};
  for (const e of excluded) exclByReason[e.reason] = (exclByReason[e.reason] ?? 0) + 1;
  console.log(`total excluded=${excluded.length} byReason=${JSON.stringify(exclByReason)}`);

  console.log('\n## 7. Equity');
  console.log(`points=${equity.length} first=${equity[0]?.t} last=${equity[equity.length - 1]?.t}`);
  const eqVals = equity.map((e: any) => e.equity);
  console.log(`equity min=${fmt(Math.min(...eqVals))} max=${fmt(Math.max(...eqVals))} final=${fmt(eqVals[eqVals.length - 1])}`);
}

main();
