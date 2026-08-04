const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

async function main() {
  await client.connect();

  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('copied_positions','executions','crypto_config','simulation_sessions','simulation_balances','exit_attempt_events','sim_archive_positions','sim_archive_executions')
    ORDER BY table_name;
  `);
  console.log('=== TABLES ===');
  console.log(tables.rows.map(r => r.table_name).join('\n'));

  for (const t of ['copied_positions', 'executions']) {
    const cols = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position;
    `, [t]);
    console.log(`\n=== COLUMNS ${t} ===`);
    console.log(cols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
  }

  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM copied_positions) AS positions_total,
      (SELECT count(*) FROM copied_positions WHERE trader_address='crypto-algo') AS positions_algo,
      (SELECT count(*) FROM executions) AS executions_total,
      (SELECT count(*) FROM sim_archive_positions) AS sim_archive_positions,
      (SELECT count(*) FROM sim_archive_executions) AS sim_archive_executions;
  `).catch(e => ({ error: e.message }));
  console.log('\n=== COUNTS ===');
  console.log(JSON.stringify(counts.rows || counts, null, 2));

  const reasons = await client.query(`
    SELECT reason, mode, status, count(*)::int AS n
    FROM copied_positions
    GROUP BY reason, mode, status
    ORDER BY n DESC;
  `);
  console.log('\n=== POSITIONS BY REASON/MODE/STATUS ===');
  console.table(reasons.rows);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
