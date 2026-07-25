/**
 * Query: find Spain/Belgium spread markets and swisstony pending positions
 * Usage: npx tsx tools/_query-spain-belgium.ts
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

  // Chercher les marchés Spain/Belgium spread
  const markets = await client.query(`
    SELECT condition_id, slug, question, end_date, resolved, winning_token_id, closed, accepting_orders
    FROM markets
    WHERE slug ILIKE '%belgium%'
       OR slug ILIKE '%spain%'
       OR question ILIKE '%belgium%'
    ORDER BY end_date DESC
  `);
  console.log('=== MARCHÉS Belgium/Spain ===');
  for (const row of markets.rows) {
    console.log(JSON.stringify(row));
  }

  // Chercher les positions swisstony avec status pending_resolution ou open
  const pending = await client.query(`
    SELECT p.id, p.status, p.close_reason, p.quantity, p.entry_price, p.entry_bid_vwap,
           p.realized_pnl, p.unrealized_pnl, p.mode, p.reason,
           p.opened_at, p.closed_at, p.sl_bid_points, p.tp_bid_points,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.watchlist_id = 16
      AND p.mode = 'sim'
      AND p.status IN ('pending_resolution', 'open', 'closing')
    ORDER BY p.id DESC
    LIMIT 30
  `);
  console.log('\n=== POSITIONS OUVERTES/PENDING swisstony ===');
  for (const row of pending.rows) {
    console.log(JSON.stringify(row));
  }

  // Chercher TOUTES les positions pending_resolution en sim
  const allPending = await client.query(`
    SELECT p.id, p.status, p.close_reason, p.quantity, p.entry_price, p.entry_bid_vwap,
           p.realized_pnl, p.unrealized_pnl, p.mode, p.reason,
           p.opened_at, p.closed_at,
           m.slug, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    WHERE p.mode = 'sim'
      AND p.status = 'pending_resolution'
    ORDER BY p.id
  `);
  console.log('\n=== TOUTES LES POSITIONS pending_resolution (sim) ===');
  if (allPending.rows.length === 0) {
    console.log('(aucune)');
  } else {
    for (const row of allPending.rows) {
      console.log(JSON.stringify(row));
    }
  }

  client.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
