/**
 * Query: find swisstony position on Spread: Belgium (-4.5)
 * Usage: npx tsx tools/_query-belgium-spread.ts
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

  // Spread: Belgium (-4.5) — fifwc-esp-bel-2026-07-10-spread-away-4pt5
  const condId = '0xe9f8ba3d2d87302555c08b477904e33facb9ae8f4c609f7bcf912bbdd75c870a';

  const positions = await client.query(`
    SELECT p.id, p.status, p.close_reason, p.quantity, p.entry_price, p.entry_bid_vwap,
           p.realized_pnl, p.unrealized_pnl, p.mode, p.reason,
           p.opened_at, p.closed_at, p.sl_bid_points, p.tp_bid_points,
           p.sl_percent, p.tp_percent, p.asset_id,
           w.nickname,
           m.slug, m.question, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           m.token_id_yes, m.token_id_no,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    LEFT JOIN watchlist w ON w.id = p.watchlist_id
    WHERE p.condition_id = $1
    ORDER BY p.id DESC
  `, [condId]);

  console.log('=== POSITIONS sur Spread: Belgium (-4.5) ===');
  for (const row of positions.rows) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }

  // Vérifier si le winning_token_id match l'asset_id
  for (const row of positions.rows) {
    const normWinner = row.winning_token_id ? row.winning_token_id.toLowerCase().trim().replace(/^0x/, '') : '';
    const normAsset = row.asset_id ? row.asset_id.toLowerCase().trim().replace(/^0x/, '') : '';
    const isWinner = normWinner !== '' && normAsset !== '' && normWinner === normAsset;
    console.log(`Position #${row.id} (${row.nickname}): status=${row.status} asset=${row.asset_id?.slice(0,20)} winner=${row.winning_token_id?.slice(0,20)} isWinner=${isWinner}`);
  }

  // Chercher aussi les positions swisstony sur les autres marchés Belgium (-4.5) avec winningTokenId
  const otherBelgium = await client.query(`
    SELECT p.id, p.status, p.close_reason, p.quantity, p.entry_price, p.entry_bid_vwap,
           p.realized_pnl, p.unrealized_pnl, p.mode, p.reason,
           p.opened_at, p.closed_at, p.sl_bid_points, p.tp_bid_points,
           w.nickname,
           m.slug, m.question, m.end_date, m.resolved, m.winning_token_id, m.closed, m.accepting_orders,
           EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 AS hours_to_end
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    LEFT JOIN watchlist w ON w.id = p.watchlist_id
    WHERE w.nickname ILIKE '%swisstony%'
      AND p.mode = 'sim'
      AND m.slug ILIKE '%belgium%'
      AND m.winning_token_id IS NOT NULL
    ORDER BY p.id DESC
  `);

  console.log('\n=== POSITIONS swisstony sur marchés Belgium avec winner ===');
  for (const row of otherBelgium.rows) {
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }

  client.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
