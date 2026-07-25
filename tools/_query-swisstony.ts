/**
 * Query: find the "swisstony / Spain / Spread: Belgium (-4.5)" position
 * Usage: npx tsx tools/_query-swisstony.ts
 */
import pg from 'pg';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();

  // Search for swisstony / Spain / Belgium spread markets
  const markets = await client.query(`
    SELECT condition_id, slug, question, end_date, resolved, winning_token_id, closed, accepting_orders
    FROM markets
    WHERE slug ILIKE '%swisstony%'
       OR slug ILIKE '%spain%belgium%'
       OR slug ILIKE '%belgium%spread%'
       OR question ILIKE '%swisstony%'
    ORDER BY end_date DESC
  `);
  console.log('=== MARCHÉS CORRESPONDANTS ===');
  for (const row of markets.rows) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }

  // Search for positions on these markets
  if (markets.rows.length > 0) {
    const condIds = markets.rows.map(r => r.condition_id);
    const positions = await client.query(`
      SELECT p.id, p.status, p.close_reason, p.quantity, p.entry_price, p.entry_bid_vwap,
             p.realized_pnl, p.unrealized_pnl, p.mode, p.reason,
             p.opened_at, p.closed_at, p.sl_bid_points, p.tp_bid_points,
             p.sl_percent, p.tp_percent,
             m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
             EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.condition_id = ANY($1)
      ORDER BY p.id
    `, [condIds]);
    console.log('\n=== POSITIONS ===');
    for (const row of positions.rows) {
      console.log(JSON.stringify(row, null, 2));
      console.log('---');
    }
  }

  // Also search by watchlist nickname "swisstony"
  const watchlist = await client.query(`
    SELECT id, nickname, trader_address FROM watchlist WHERE nickname ILIKE '%swisstony%'
  `);
  console.log('\n=== WATCHLIST ===');
  for (const row of watchlist.rows) {
    console.log(JSON.stringify(row, null, 2));
  }

  // Find positions for this watchlist
  if (watchlist.rows.length > 0) {
    const wlId = watchlist.rows[0].id;
    const wlPositions = await client.query(`
      SELECT p.id, p.status, p.close_reason, p.quantity, p.entry_price, p.entry_bid_vwap,
             p.realized_pnl, p.unrealized_pnl, p.mode, p.reason,
             p.opened_at, p.closed_at, p.sl_bid_points, p.tp_bid_points,
             m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
             EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.watchlist_id = $1
        AND p.mode = 'sim'
      ORDER BY p.id DESC
      LIMIT 20
    `, [wlId]);
    console.log('\n=== POSITIONS POUR swisstony (sim) ===');
    for (const row of wlPositions.rows) {
      console.log(JSON.stringify(row, null, 2));
      console.log('---');
    }
  }

  client.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
