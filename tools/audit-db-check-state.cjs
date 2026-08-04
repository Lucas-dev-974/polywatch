const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

async function main() {
  await client.connect();
  const cfg = await client.query('SELECT id, crypto_algo_enabled FROM crypto_config');
  console.log('crypto_config:', JSON.stringify(cfg.rows));
  const open = await client.query(`
    SELECT id, mode, status, outcome, quantity, entry_price, opened_at
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND status IN ('open','closing')
  `);
  console.log('open algo positions:', JSON.stringify(open.rows));
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
