/**
 * Query tool: find positions awaiting redemption and check their market endDate.
 * Usage: npx tsx tools/_query-redemption.ts
 */
import pg from 'pg';
import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function fmtHrs(v: unknown): string {
  if (v == null) return 'NULL';
  return Number(v).toFixed(1);
}

async function main() {
  const client = await pool.connect();

  // 1. Sim config
  const config = await client.query(`
    SELECT sim_initial_capital, sim_sl_percent, sim_tp_percent, sim_trailing_enabled, sim_trailing_stop_percent,
           sim_sl_bid_points, sim_tp_bid_points, sim_pre_close_enabled, sim_pre_close_seconds,
           sim_min_time_to_close, sim_sl_tp_enabled, sim_copy_trading_enabled
    FROM risk_config LIMIT 1
  `);
  console.log('=== SIM CONFIG ===');
  console.log(JSON.stringify(config.rows[0], null, 2));

  // 2. Positions pending_resolution
  const pending = await client.query(`
    SELECT p.id, p.status, p.close_reason, p.quantity, p.realized_pnl, p.mode,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.status = 'pending_resolution'
    ORDER BY p.id
  `);
  console.log('\n=== POSITIONS pending_resolution ===');
  if (pending.rows.length === 0) {
    console.log('(none)');
  } else {
    for (const row of pending.rows) {
      console.log(`#${row.id} [${row.status}] qty=${row.quantity} slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} hrs_to_end=${fmtHrs(row.hours_to_end)} winner=${String(row.winning_token_id ?? '').slice(0,10)}`);
    }
  }

  // 3. Open positions on markets with winningTokenId set (should be pending_resolution)
  const openWithWinner = await client.query(`
    SELECT p.id, p.status, p.close_reason, p.quantity, p.realized_pnl, p.mode,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.status IN ('open', 'closing', 'failed')
      AND m.winning_token_id IS NOT NULL
    ORDER BY p.id
  `);
  console.log('\n=== OPEN/CLOSING/FAILED positions on markets WITH winningTokenId (should be pending_resolution) ===');
  if (openWithWinner.rows.length === 0) {
    console.log('(none)');
  } else {
    for (const row of openWithWinner.rows) {
      console.log(`#${row.id} [${row.status}] qty=${row.quantity} slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} hrs_to_end=${fmtHrs(row.hours_to_end)} winner=${String(row.winning_token_id ?? '').slice(0,10)}`);
    }
  }

  // 4. Markets with winningTokenId but endDate far in the future
  const earlyWin = await client.query(`
    SELECT condition_id, slug, question, end_date, resolved, winning_token_id, closed, accepting_orders,
           EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 AS hours_to_end
    FROM markets
    WHERE winning_token_id IS NOT NULL
      AND end_date > NOW() + interval '1 hour'
    ORDER BY end_date
  `);
  console.log('\n=== MARKETS with winningTokenId but endDate > +1H ===');
  if (earlyWin.rows.length === 0) {
    console.log('(none)');
  } else {
    for (const row of earlyWin.rows) {
      console.log(`slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} hrs_to_end=${fmtHrs(row.hours_to_end)} winner=${String(row.winning_token_id ?? '').slice(0,10)} resolved=${row.resolved} closed=${row.closed} accepting=${row.accepting_orders}`);
    }
  }

  // 5. Markets past endDate still accepting orders (no winner yet)
  const pastEnd = await client.query(`
    SELECT condition_id, slug, question, end_date, resolved, winning_token_id, closed, accepting_orders,
           EXTRACT(EPOCH FROM (NOW() - end_date)) / 3600 AS hours_past_end
    FROM markets
    WHERE end_date < NOW()
      AND accepting_orders = 1
      AND winning_token_id IS NULL
    ORDER BY end_date DESC
    LIMIT 20
  `);
  console.log('\n=== MARKETS past endDate but still accepting orders (no winner) ===');
  if (pastEnd.rows.length === 0) {
    console.log('(none)');
  } else {
    for (const row of pastEnd.rows) {
      console.log(`slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} hrs_past=${fmtHrs(row.hours_past_end)} resolved=${row.resolved} closed=${row.closed} accepting=${row.accepting_orders}`);
    }
  }

  // 6. Open positions with market endDate > +1H
  const openFar = await client.query(`
    SELECT p.id, p.status, p.quantity, p.unrealized_pnl, p.realized_pnl, p.close_reason,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.mode = 'sim' AND p.status = 'open'
      AND m.end_date > NOW() + interval '1 hour'
    ORDER BY m.end_date
  `);
  console.log('\n=== OPEN positions with endDate > +1H ===');
  console.log(`Count: ${openFar.rows.length}`);
  for (const row of openFar.rows.slice(0, 10)) {
    console.log(`#${row.id} [${row.status}] qty=${row.quantity} slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} hrs=${fmtHrs(row.hours_to_end)}`);
  }

  // 7. Open positions with market endDate < +1H (approaching end)
  const openNear = await client.query(`
    SELECT p.id, p.status, p.quantity, p.unrealized_pnl, p.realized_pnl, p.close_reason,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) AS seconds_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.mode = 'sim' AND p.status = 'open'
      AND m.end_date <= NOW() + interval '1 hour'
      AND m.end_date > NOW()
    ORDER BY m.end_date
  `);
  console.log('\n=== OPEN positions with endDate < +1H (TIME_EXIT/PRE_CLOSE zone) ===');
  console.log(`Count: ${openNear.rows.length}`);
  for (const row of openNear.rows) {
    console.log(`#${row.id} [${row.status}] qty=${row.quantity} slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} sec=${fmtHrs(row.seconds_to_end)}`);
  }

  // 8. Open positions past endDate (should be in redemption path)
  const openPast = await client.query(`
    SELECT p.id, p.status, p.quantity, p.unrealized_pnl, p.realized_pnl, p.close_reason,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (NOW() - m.end_date)) / 3600 AS hours_past_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.mode = 'sim' AND p.status = 'open'
      AND m.end_date <= NOW()
    ORDER BY m.end_date
  `);
  console.log('\n=== OPEN positions PAST endDate (should be in redemption path) ===');
  console.log(`Count: ${openPast.rows.length}`);
  for (const row of openPast.rows) {
    console.log(`#${row.id} [${row.status}] qty=${row.quantity} slug=${String(row.slug ?? '').slice(0,40)} end=${row.end_date} hrs_past=${fmtHrs(row.hours_past_end)} winner=${String(row.winning_token_id ?? '').slice(0,10)} resolved=${row.resolved}`);
  }

  client.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
