/**
 * Rétro-tag des positions algo `cancelled` sans `close_reason`.
 *
 * Heuristique : ALGO_OPEN annulée sans aucune exécution BUY → `reservation_released`
 * (purge manuelle file, release pipeline, ou worker jamais consommé).
 *
 * Usage:
 *   npx tsx tools/backfill-close-reason-reservation-released.ts           # dry-run
 *   npx tsx tools/backfill-close-reason-reservation-released.ts --confirm  # applique
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const confirm = process.argv.includes('--confirm');

const SELECT_SQL = `
  SELECT p.id, p.condition_id, p.opened_at, p.closed_at
  FROM copied_positions p
  WHERE p.status = 'cancelled'
    AND p.close_reason IS NULL
    AND p.reason = 'ALGO_OPEN'
    AND NOT EXISTS (
      SELECT 1 FROM executions e
      WHERE e.copied_position_id = p.id AND e.side = 'BUY'
    )
  ORDER BY p.id
`;

const UPDATE_SQL = `
  UPDATE copied_positions p
  SET close_reason = 'reservation_released'
  WHERE p.status = 'cancelled'
    AND p.close_reason IS NULL
    AND p.reason = 'ALGO_OPEN'
    AND NOT EXISTS (
      SELECT 1 FROM executions e
      WHERE e.copied_position_id = p.id AND e.side = 'BUY'
    )
`;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const preview = await client.query(SELECT_SQL);
    console.log(
      confirm ? '\n=== BACKFILL (confirm) ===\n' : '\n=== APERÇU (dry-run) ===\n',
    );
    console.log(`Positions candidates: ${preview.rowCount ?? 0}`);
    if (preview.rows.length > 0) {
      console.log(JSON.stringify(preview.rows.slice(0, 20), null, 2));
      if (preview.rows.length > 20) {
        console.log(`… et ${preview.rows.length - 20} autres`);
      }
    }

    if (!confirm) {
      console.log('\nAucune modification. Relancez avec --confirm pour appliquer.');
      return;
    }

    const result = await client.query(UPDATE_SQL);
    console.log(`\nMise à jour: ${result.rowCount ?? 0} ligne(s) → close_reason = reservation_released`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
