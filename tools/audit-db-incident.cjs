const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

async function main() {
  await client.connect();

  const pos = await client.query(`
    SELECT id, status, mode, outcome, quantity, entry_price, opened_at, closed_at, close_reason,
           realized_pnl, closing_started_at, forced_exit_failed_attempts, exit_emit_blocked_count,
           sl_bid_points, trailing_bid_points, trailing_activation_bid_points, liquidity_status
    FROM copied_positions
    WHERE id IN (29298, 29252, 29261, 29316, 29231);
  `);
  console.table(pos.rows);

  const day = await client.query(`
    SELECT status, count(*)::int AS n, round(sum(realized_pnl)::numeric,2) AS pnl
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE')
      AND opened_at::date = '2026-07-23'
    GROUP BY status;
  `);
  console.log('\nJuly 23 positions:');
  console.table(day.rows);

  // how long was 29298 stuck in closing?
  const ev = await client.query(`
    SELECT kind, block_reason, error, created_at, mark_bid
    FROM exit_attempt_events
    WHERE copied_position_id = 29298
    ORDER BY created_at;
  `);
  console.log('\n29298 events timeline (first 12 + last 4):');
  const rows = ev.rows;
  for (const r of [...rows.slice(0, 12), ...(rows.length > 16 ? ['...'] : []), ...rows.slice(-4)]) {
    console.log(typeof r === 'string' ? r : `${r.created_at.toISOString()} ${r.kind} ${r.block_reason ?? ''} ${r.error ?? ''} bid=${r.mark_bid}`);
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
