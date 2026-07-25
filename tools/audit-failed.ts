import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const failedIds = [3703, 3707];

async function main() {
  const client = await pool.connect();

  try {
    for (const posId of failedIds) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`POSITION ${posId}`);
      console.log(`${'='.repeat(60)}`);

      // Position details
      const posRes = await client.query(`
        SELECT p.*, m.question, m.condition_id as m_condition_id
        FROM copied_positions p
        LEFT JOIN markets m ON p.condition_id = m.condition_id
        WHERE p.id = $1
      `, [posId]);
      const pos = posRes.rows[0];
      console.log('\n--- Position ---');
      if (pos) {
        for (const [k, v] of Object.entries(pos)) {
          console.log(`  ${k}: ${v}`);
        }
      }

      // All executions for this position
      const execsRes = await client.query(`
        SELECT id, side, status, order_type, requested_qty, fill_price, fill_quantity, fees, realized_pnl, reason, error, executed_at, clob_order_id, tx_hash
        FROM executions WHERE copied_position_id = $1 ORDER BY id
      `, [posId]);
      console.log(`\n--- Executions (${execsRes.rows.length} total) ---`);
      execsRes.rows.forEach((e: any) => {
        console.log(`  #${e.id} ${e.side} [${e.status}] fill=${e.fill_price} qty=${e.fill_quantity} fees=${e.fees} realized=${e.realized_pnl} reason=${e.reason} error=${e.error} at=${e.executed_at}`);
      });

      // Related move events
      const movesRes = await client.query(`
        SELECT * FROM move_events WHERE copied_position_id = $1 ORDER BY detected_at
      `, [posId]);
      console.log(`\n--- Move Events (${movesRes.rows.length}) ---`);
      movesRes.rows.forEach((m: any) => {
        console.log(`  id=${m.id} type=${m.move_type} side=${m.side} delta=${m.delta_size} price=${m.price} at=${m.detected_at}`);
      });

      // Related order signals (if any stored)
      const signalsRes = await client.query(`
        SELECT * FROM order_signals WHERE copied_position_id = $1 ORDER BY created_at
      `, [posId]);
      console.log(`\n--- Order Signals (${signalsRes.rows.length}) ---`);
      signalsRes.rows.forEach((s: any) => {
        console.log(`  id=${s.id} side=${s.side} qty=${s.quantity} price=${s.limit_price} status=${s.status} at=${s.created_at}`);
      });

      // Reservations
      const reservationsRes = await client.query(`
        SELECT * FROM position_reservations WHERE copied_position_id = $1 ORDER BY created_at
      `, [posId]);
      console.log(`\n--- Reservations (${reservationsRes.rows.length}) ---`);
      reservationsRes.rows.forEach((r: any) => {
        console.log(`  id=${r.id} qty=${r.reserved_quantity} status=${r.status} ttl=${r.ttl_ms} at=${r.created_at}`);
      });
    }

    // Also check: what close_reason is on these positions?
    console.log('\n\n=== CLOSE REASON ON FAILED POSITIONS ===');
    const reasonsRes = await client.query(`
      SELECT id, close_reason, status FROM copied_positions WHERE id IN (3703, 3707)
    `);
    console.log(reasonsRes.rows);

    // Check if there are any SELL executions that failed - what errors?
    console.log('\n\n=== FAILED SELL EXECUTIONS FOR 3703, 3707 ===');
    const failedSellsRes = await client.query(`
      SELECT e.id, e.copied_position_id, e.side, e.status, e.reason, e.error, e.executed_at, e.requested_qty, e.fill_price, e.fill_quantity
      FROM executions e WHERE e.copied_position_id IN (3703, 3707) AND e.side = 'SELL' AND e.status = 'failed'
      ORDER BY e.id
    `);
    failedSellsRes.rows.forEach((e: any) => {
      console.log(`  exec#${e.id} pos=${e.copied_position_id} reason=${e.reason} error=${e.error} req_qty=${e.requested_qty} fill_price=${e.fill_price} fill_qty=${e.fill_quantity} at=${e.executed_at}`);
    });

    // Count failed sell attempts per position
    console.log('\n\n=== FAILED SELL COUNT PER POSITION ===');
    const failCountsRes = await client.query(`
      SELECT copied_position_id, COUNT(*) as cnt
      FROM executions WHERE copied_position_id IN (3703, 3707) AND side = 'SELL' AND status = 'failed'
      GROUP BY copied_position_id
    `);
    console.log(failCountsRes.rows);

    // Check the last few failed sell errors in detail
    console.log('\n\n=== LAST 5 FAILED SELLS FOR 3703 ===');
    const last3703Res = await client.query(`
      SELECT id, reason, error, executed_at, requested_qty FROM executions
      WHERE copied_position_id = 3703 AND side = 'SELL' AND status = 'failed'
      ORDER BY id DESC LIMIT 5
    `);
    last3703Res.rows.forEach((e: any) => console.log(`  #${e.id} reason=${e.reason} error=${e.error} req_qty=${e.requested_qty} at=${e.executed_at}`));

    console.log('\n\n=== LAST 5 FAILED SELLS FOR 3707 ===');
    const last3707Res = await client.query(`
      SELECT id, reason, error, executed_at, requested_qty FROM executions
      WHERE copied_position_id = 3707 AND side = 'SELL' AND status = 'failed'
      ORDER BY id DESC LIMIT 5
    `);
    last3707Res.rows.forEach((e: any) => console.log(`  #${e.id} reason=${e.reason} error=${e.error} req_qty=${e.requested_qty} at=${e.executed_at}`));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});