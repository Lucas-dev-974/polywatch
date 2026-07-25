/**
 * Drop orphaned tables from removed activity/shadow detection.
 *
 * Usage:
 *   npm run db:drop-shadow-tables
 *
 * Safe to run while app is running (read-only legacy tables).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config as dotenvConfig } from 'dotenv';

const TABLES = ['shadow_divergences', 'trader_activity_cursors'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenvConfig({ path: resolve(root, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL must be set in .env or environment');
  process.exit(1);
}

async function tableExists(client, table) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    console.log(`Dialect: postgres`);
    console.log(`Target:  ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}\n`);

    for (const table of TABLES) {
      if (!(await tableExists(client, table))) {
        console.log(`  skipped  ${table} (not found)`);
        continue;
      }
      const countResult = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      const count = countResult.rows[0]?.n ?? 0;
      await client.query(`DROP TABLE IF EXISTS ${table}`);
      console.log(`  dropped  ${table} (${count} rows)`);
    }

    console.log('\nDone.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});