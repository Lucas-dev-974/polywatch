import { createDataSource, initializeDataSource } from '../packages/core/src/database/data-source';
import path from 'path';

async function main() {
  const ds = createDataSource(path.resolve('./data/polywatch.db'));
  await initializeDataSource(ds);

  const positionId = 28455;

  console.log('=== POSITION #28455 ===');
  const positions = await ds.query(
    `SELECT id, condition_id, outcome, status, mode, quantity, entry_price, entry_bid_vwap,
            executable_bid_vwap, realized_pnl, unrealized_pnl, opened_at, closed_at,
            close_reason, closing_reason, reason, sl_bid_points, tp_bid_points,
            last_exit_block_reason, last_exit_block_close_reason, exit_emit_blocked_count
     FROM copied_positions WHERE id = ?`,
    [positionId],
  );
  console.log(JSON.stringify(positions[0], null, 2));

  console.log('\n=== EXECUTIONS FOR #28455 ===');
  const executions = await ds.query(
    `SELECT id, side, status, reason, mode, fill_price, fill_quantity, realized_pnl,
            error, executed_at, order_signal_id
     FROM executions WHERE copied_position_id = ? ORDER BY id`,
    [positionId],
  );
  executions.forEach((e: any) => console.log(JSON.stringify(e)));

  console.log('\n=== EXIT ATTEMPT EVENTS FOR #28455 ===');
  const events = await ds.query(
    `SELECT id, kind, close_reason, block_reason, error, mark_bid, created_at, execution_id
     FROM exit_attempt_events WHERE copied_position_id = ? ORDER BY id`,
    [positionId],
  );
  events.forEach((e: any) => console.log(JSON.stringify(e)));

  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
