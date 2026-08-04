const fs = require('fs');
const d = JSON.parse(fs.readFileSync('tools/audit-db-data.json', 'utf8'));

const scope = d.auditScope || 'all_history';
const isSessionScope = scope === 'active_sim_session';

// Primary position pool: active sim session uses live table only; legacy uses archive.
const sessionPositions = d.positions.filter(p => p.mode === 'sim' || isSessionScope);
const algoArch = isSessionScope
  ? []
  : d.archivePositions.filter(p => ['ALGO_OPEN', 'ALGO_INCREASE'].includes(p.reason));

const primaryPool = isSessionScope ? sessionPositions : algoArch;
const traded = primaryPool.filter(p => !['reservation_released', 'reservation_expired'].includes(p.close_reason));
const closedTraded = traded.filter(p => p.status === 'closed' || p.closed_at);

function stats(rows) {
  const pnls = rows.map(p => +(p.realized_pnl ?? 0));
  const wins = pnls.filter(x => x > 0);
  const losses = pnls.filter(x => x < 0);
  const sum = pnls.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const wl = wins.length + losses.length;
  return {
    n: rows.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: pnls.filter(x => x === 0).length,
    winrate: +(100 * wins.length / Math.max(1, wl || rows.length)).toFixed(1),
    totalPnl: +sum.toFixed(2),
    avgPnl: +(sum / Math.max(1, rows.length)).toFixed(4),
    avgWin: +(grossWin / Math.max(1, wins.length)).toFixed(4),
    avgLoss: +(grossLoss / Math.max(1, losses.length)).toFixed(4),
    profitFactor: +(grossWin / Math.max(0.0001, grossLoss)).toFixed(2),
    maxWin: pnls.length ? +Math.max(0, ...pnls).toFixed(2) : 0,
    maxLoss: pnls.length ? +Math.min(0, ...pnls).toFixed(2) : 0,
  };
}

const out = {
  auditScope: scope,
  session: d.session || null,
};

const dates = primaryPool.map(p => p.opened_at).filter(Boolean).sort();
out.range = { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };

out.traded = stats(traded);
out.closedTraded = stats(closedTraded);

// Backward-compatible aliases (legacy scripts / canvas may reference these)
out.archiveRange = out.range;
out.archiveTraded = out.traded;
out.currentTraded = isSessionScope ? out.closedTraded : stats(d.positions.filter(p => p.status === 'closed'));
out.currentSim = isSessionScope ? out.closedTraded : stats(d.positions.filter(p => p.status === 'closed' && p.mode === 'sim'));
out.currentReal = isSessionScope
  ? stats([])
  : stats(d.positions.filter(p => p.status === 'closed' && p.mode === 'real'));
out.archiveSimVsReal = {
  sim: out.traded,
  real: stats([]),
};

out.archiveHasMode = primaryPool.length > 0 && 'mode' in primaryPool[0];
out.sampleRow = primaryPool[0] ?? null;
out.sampleArchiveRow = out.sampleRow;

const byDay = {};
for (const p of closedTraded) {
  if (!p.closed_at) continue;
  const day = p.closed_at.slice(0, 10);
  byDay[day] = byDay[day] || { pnl: 0, n: 0, wins: 0 };
  byDay[day].pnl += +(p.realized_pnl ?? 0);
  byDay[day].n++;
  if ((p.realized_pnl ?? 0) > 0) byDay[day].wins++;
}
let cum = 0;
out.daily = Object.entries(byDay).sort(([a], [b]) => a < b ? -1 : 1).map(([day, v]) => {
  cum += v.pnl;
  return { day, pnl: +v.pnl.toFixed(2), cum: +cum.toFixed(2), trades: v.n, winrate: +(100 * v.wins / v.n).toFixed(0) };
});

const buckets = {};
for (const p of traded) {
  const e = +p.entry_price;
  if (!e || e <= 0 || e >= 1) continue;
  const b = (Math.floor(e * 20) / 20).toFixed(2);
  buckets[b] = buckets[b] || { n: 0, pnl: 0, wins: 0 };
  buckets[b].n++;
  buckets[b].pnl += +(p.realized_pnl ?? 0);
  if ((p.realized_pnl ?? 0) > 0) buckets[b].wins++;
}
const minBucketN = isSessionScope ? 5 : 20;
out.byEntryBucket = Object.entries(buckets).sort(([a], [b]) => +a - +b)
  .map(([b, v]) => ({ bucket: `${b}-${(+b + 0.05).toFixed(2)}`, n: v.n, pnl: +v.pnl.toFixed(2), avg: +(v.pnl / v.n).toFixed(4), winrate: +(100 * v.wins / v.n).toFixed(1) }))
  .filter(x => x.n >= minBucketN);

const byReason = {};
for (const p of traded) {
  const k = p.close_reason ?? 'null';
  byReason[k] = byReason[k] || { n: 0, pnl: 0, wins: 0 };
  byReason[k].n++;
  byReason[k].pnl += +(p.realized_pnl ?? 0);
  if ((p.realized_pnl ?? 0) > 0) byReason[k].wins++;
}
out.byCloseReason = Object.entries(byReason).map(([k, v]) => ({ reason: k, n: v.n, pnl: +v.pnl.toFixed(2), avg: +(v.pnl / v.n).toFixed(4), winrate: +(100 * v.wins / v.n).toFixed(1) })).sort((a, b) => b.n - a.n);

const durs = traded.filter(p => p.opened_at && p.closed_at)
  .map(p => (new Date(p.closed_at) - new Date(p.opened_at)) / 1000);
durs.sort((a, b) => a - b);
out.duration = {
  n: durs.length,
  p10: durs[Math.floor(durs.length * 0.1)]?.toFixed(0),
  p50: durs[Math.floor(durs.length * 0.5)]?.toFixed(0),
  p90: durs[Math.floor(durs.length * 0.9)]?.toFixed(0),
  max: durs[durs.length - 1]?.toFixed(0),
  under30s: durs.filter(x => x < 30).length,
  under60s: durs.filter(x => x < 60).length,
};
out.durationArchive = out.duration;

const sl = traded.filter(p => p.close_reason === 'SL');
out.slLeg = {
  n: sl.length,
  avgEntry: +(sl.reduce((a, p) => a + (+p.entry_price || 0), 0) / Math.max(1, sl.length)).toFixed(4),
  avgExit: +(sl.reduce((a, p) => a + (+p.exit_price || 0), 0) / Math.max(1, sl.length)).toFixed(4),
  avgPnl: +(sl.reduce((a, p) => a + (+p.realized_pnl || 0), 0) / Math.max(1, sl.length)).toFixed(4),
};
const tp = traded.filter(p => p.close_reason === 'TP');
out.tpLeg = {
  n: tp.length,
  avgEntry: +(tp.reduce((a, p) => a + (+p.entry_price || 0), 0) / Math.max(1, tp.length)).toFixed(4),
  avgExit: +(tp.reduce((a, p) => a + (+p.exit_price || 0), 0) / Math.max(1, tp.length)).toFixed(4),
  avgPnl: +(tp.reduce((a, p) => a + (+p.realized_pnl || 0), 0) / Math.max(1, tp.length)).toFixed(4),
};
const red = traded.filter(p => p.close_reason === 'REDEMPTION');
out.redemptionLeg = {
  n: red.length,
  avgEntry: +(red.reduce((a, p) => a + (+p.entry_price || 0), 0) / Math.max(1, red.length)).toFixed(4),
  wins: red.filter(p => (p.realized_pnl ?? 0) > 0).length,
  avgPnl: +(red.reduce((a, p) => a + (+p.realized_pnl || 0), 0) / Math.max(1, red.length)).toFixed(4),
};

const wlTraded = traded.filter(p => (p.realized_pnl ?? 0) > 0 || (p.realized_pnl ?? 0) < 0);
out.wlTraded = stats(wlTraded);

out.reservationChurn = primaryPool.filter(p => ['reservation_released', 'reservation_expired'].includes(p.close_reason)).length;
out.archiveReservationChurn = out.reservationChurn;

let peak = -Infinity, maxDD = 0, c2 = 0;
for (const p of [...closedTraded].sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at))) {
  if (!p.closed_at) continue;
  c2 += +(p.realized_pnl ?? 0);
  if (c2 > peak) peak = c2;
  const dd = peak - c2;
  if (dd > maxDD) maxDD = dd;
}
out.maxDrawdown = +maxDD.toFixed(2);

fs.writeFileSync('tools/audit-db-metrics.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
