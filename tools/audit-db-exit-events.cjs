const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

async function main() {
  await client.connect();

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='exit_attempt_events' ORDER BY ordinal_position;
  `);
  console.log('columns:', cols.rows.map(r => r.column_name).join(', '));

  const summary = await client.query(`
    SELECT * FROM exit_attempt_events ORDER BY id DESC LIMIT 5;
  `);
  console.log('\nsample rows:');
  console.log(JSON.stringify(summary.rows, null, 2));

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
