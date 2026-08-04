const fs = require('fs');
const d = JSON.parse(fs.readFileSync('tools/audit-db-data.json', 'utf8'));

console.log('archiveColumns:', d.archiveColumns.join(','));
console.log('has reason col:', d.archiveColumns.includes('reason'));

// Are archive positions actually algo? check reason distribution
const reasonDist = {};
for (const p of d.archivePositions) {
  const k = p.reason ?? 'null';
  reasonDist[k] = (reasonDist[k] || 0) + 1;
}
console.log('\n=== ARCHIVE reason distribution ===');
console.log(reasonDist);

// Current positions summary
console.log('\n=== CURRENT positions (ALGO_OPEN) ===');
for (const p of d.positions) {
  console.log(`${p.id} ${p.mode} ${p.status} ${p.outcome} qty=${p.quantity} entry=${p.entry_price} pnl=${p.realized_pnl} close=${p.close_reason} opened=${p.opened_at} closed=${p.closed_at} cond=${String(p.condition_id).slice(0,12)}…`);
}

console.log('\n=== closeReasons (current) ===');
console.table(d.closeReasons);
console.log('\n=== byOutcome ===');
console.table(d.byOutcome);
console.log('\n=== durations ===');
console.table(d.durations);
console.log('\n=== exitBlocks ===');
console.table(d.exitBlocks);
console.log('\n=== execStats ===');
console.table(d.execStats);
console.log('\n=== stuckPositions ===');
console.table(d.stuckPositions);
console.log('\n=== cancelled ===');
console.table(d.cancelled);
console.log('\n=== dailyPnl ===');
console.table(d.dailyPnl);
console.log('\n=== concentration (top) ===');
console.table(d.concentration.slice(0, 15));
console.log('\n=== archiveCloseReasons ===');
console.table(d.archiveCloseReasons || []);
console.log('\nexitAttemptEvents:', d.exitAttemptEvents);

// Archive stats if they are algo
if (d.archiveColumns.includes('reason')) {
  const algoArch = d.archivePositions.filter(p => ['ALGO_OPEN','ALGO_INCREASE'].includes(p.reason));
  console.log('\n=== ARCHIVE algo positions:', algoArch.length, '===');
  if (algoArch.length > 0) {
    const closed = algoArch.filter(p => p.close_reason != null);
    const pnls = closed.map(p => p.realized_pnl ?? 0);
    const wins = pnls.filter(x => x > 0).length;
    const losses = pnls.filter(x => x < 0).length;
    const sum = pnls.reduce((a, b) => a + b, 0);
    console.log(`closed=${closed.length} wins=${wins} losses=${losses} winrate=${(100*wins/Math.max(1,closed.length)).toFixed(1)}% totalPnl=${sum.toFixed(2)} avg=${(sum/Math.max(1,closed.length)).toFixed(4)}`);
    const byReason = {};
    for (const p of closed) {
      const k = p.close_reason;
      byReason[k] = byReason[k] || { n: 0, pnl: 0 };
      byReason[k].n++;
      byReason[k].pnl += p.realized_pnl ?? 0;
    }
    console.table(Object.entries(byReason).map(([k, v]) => ({ close_reason: k, n: v.n, pnl: +v.pnl.toFixed(2) })).sort((a,b)=>b.n-a.n));
  }
}

// Crypto config snapshot
if (d.cryptoConfig) {
  console.log('\n=== cryptoConfig (current) ===');
  const c = d.cryptoConfig;
  const interesting = Object.entries(c).filter(([k]) => /algo|sim_initial/i.test(k));
  for (const [k, v] of interesting) console.log(`${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}
