import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch' });

async function main() {
  const client = await pool.connect();
  const positionId = 28455;

  try {
    console.log('=== POSITION #28455 ===');
    const positionRes = await client.query(
      `SELECT id, condition_id, outcome, status, mode, quantity, entry_price, entry_bid_vwap,
              executable_bid_vwap, realized_pnl, unrealized_pnl, opened_at, closed_at,
              close_reason, closing_reason, reason, sl_bid_points, tp_bid_points,
              last_exit_block_reason, last_exit_block_close_reason, exit_emit_blocked_count
       FROM copied_positions WHERE id = $1`,
      [positionId],
    );
    console.log(JSON.stringify(positionRes.rows[0], null, 2));

    console.log('\n=== EXECUTIONS FOR #28455 ===');
    const execRes = await client.query(
      `SELECT id, side, status, reason, mode, fill_price, fill_quantity, realized_pnl,
              error, executed_at, order_signal_id
       FROM executions WHERE copied_position_id = $1 ORDER BY id`,
      [positionId],
    );
    execRes.rows.forEach((e: any) => console.log(JSON.stringify(e)));

    console.log('\n=== EXIT ATTEMPT EVENTS FOR #28455 ===');
    const eventsRes = await client.query(
      `SELECT id, kind, close_reason, block_reason, error, mark_bid, created_at, execution_id
       FROM exit_attempt_events WHERE copied_position_id = $1 ORDER BY id`,
      [positionId],
    );
    eventsRes.rows.forEach((e: any) => console.log(JSON.stringify(e)));

    console.log('\n=== ALGO SURVEILLANCE SNAPSHOTS FOR #28455 ===');
    const survRes = await client.query(
      `SELECT id, condition_id, mode, status, positions_json, created_at
       FROM algo_surveillance_snapshots
       WHERE positions_json::text LIKE $1
       ORDER BY created_at`,
      [`%"id":${positionId}%`],
    );
    console.log(`Found ${survRes.rows.length} snapshots containing position ${positionId}`);
    survRes.rows.forEach((s: any) => {
      const positions = JSON.parse(s.positions_json ?? '[]') as any[];
      const pos = positions.find((p: any) => p.id === positionId);
      if (pos) {
        console.log(JSON.stringify({ snapshot_id: s.id, created_at: s.created_at, pos }, null, 2));
      }
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
