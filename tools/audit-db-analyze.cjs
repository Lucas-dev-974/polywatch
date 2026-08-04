const fs = require('fs');
const d = JSON.parse(fs.readFileSync('tools/audit-db-data.json', 'utf8'));

const scope = d.auditScope || 'all_history';
console.log('auditScope:', scope);

if (d.session) {
  console.log('\n=== ACTIVE SIM SESSION ===');
  console.log(`session_id: ${d.session.session_id}`);
  console.log(`boundary_at: ${d.session.boundary_at}`);
  console.log(`baseline_capital: ${d.session.baseline_capital ?? d.session.balance_baseline}`);
  console.log(`balance_amount: ${d.session.balance_amount}`);
}

if (scope === 'all_history') {
  console.log('archiveColumns:', (d.archiveColumns || []).join(','));
  const reasonDist = {};
  for (const p of d.archivePositions || []) {
    const k = p.reason ?? 'null';
    reasonDist[k] = (reasonDist[k] || 0) + 1;
  }
  console.log('\n=== ARCHIVE reason distribution ===');
  console.log(reasonDist);
}

console.log('\n=== POSITIONS (scoped) ===');
for (const p of d.positions) {
  console.log(`${p.id} ${p.mode ?? 'sim'} ${p.status} ${p.outcome} qty=${p.quantity} entry=${p.entry_price} pnl=${p.realized_pnl} close=${p.close_reason} opened=${p.opened_at} closed=${p.closed_at} cond=${String(p.condition_id).slice(0, 12)}…`);
}

console.log('\n=== closeReasons ===');
console.table(d.closeReasons);
console.log('\n=== byOutcome ===');
console.table(d.byOutcome);
console.log('\n=== durations ===');
console.table(Array.isArray(d.durations) ? d.durations : [d.durations].filter(Boolean));
console.log('\n=== exitBlocks ===');
console.table(d.exitBlocks);
console.log('\n=== execStats ===');
console.table(d.execStats);
console.log('\n=== stuckPositions ===');
console.table(d.stuckPositions);
console.log('\n=== cancelled ===');
console.table(Array.isArray(d.cancelled) ? d.cancelled : [d.cancelled].filter(x => x && x.n != null));
console.log('\n=== dailyPnl ===');
console.table(d.dailyPnl);
console.log('\n=== concentration (top) ===');
console.table((d.concentration || []).slice(0, 15));

if (scope === 'all_history') {
  console.log('\n=== archiveCloseReasons ===');
  console.table(d.archiveCloseReasons || []);
  if ((d.archiveColumns || []).includes('reason')) {
    const algoArch = d.archivePositions.filter(p => ['ALGO_OPEN', 'ALGO_INCREASE'].includes(p.reason));
    console.log('\n=== ARCHIVE algo positions:', algoArch.length, '===');
    if (algoArch.length > 0) {
      const closed = algoArch.filter(p => p.close_reason != null);
      const pnls = closed.map(p => p.realized_pnl ?? 0);
      const wins = pnls.filter(x => x > 0).length;
      const losses = pnls.filter(x => x < 0).length;
      const sum = pnls.reduce((a, b) => a + b, 0);
      console.log(`closed=${closed.length} wins=${wins} losses=${losses} winrate=${(100 * wins / Math.max(1, closed.length)).toFixed(1)}% totalPnl=${sum.toFixed(2)} avg=${(sum / Math.max(1, closed.length)).toFixed(4)}`);
    }
  }
}

console.log('\nexitAttemptEvents:', d.exitAttemptEvents);

if (d.cryptoConfig) {
  console.log('\n=== cryptoConfig (current) ===');
  const c = d.cryptoConfig;
  const interesting = Object.entries(c).filter(([k]) => /algo|sim_initial/i.test(k));
  for (const [k, v] of interesting) console.log(`${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}
