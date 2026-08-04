const { Client } = require('pg');
const {
  ALGO_REASONS_SQL,
  parseArgs,
  resolveActiveSimSession,
  sessionPositionScope,
} = require('./audit-db-session.cjs');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

const opts = parseArgs(process.argv.slice(2));

async function main() {
  await client.connect();

  const cfg = await client.query('SELECT id, crypto_algo_enabled FROM crypto_config ORDER BY id DESC LIMIT 1');
  console.log('crypto_config:', JSON.stringify(cfg.rows));

  if (opts.allHistory) {
    const open = await client.query(`
      SELECT id, mode, status, outcome, quantity, entry_price, opened_at
      FROM copied_positions
      WHERE reason IN ${ALGO_REASONS_SQL} AND status IN ('open','closing')
      ORDER BY opened_at;
    `);
    console.log('open algo positions (all modes):', JSON.stringify(open.rows));
  } else {
    const session = await resolveActiveSimSession(client);
    console.log('active sim session:', JSON.stringify({
      session_id: session.session_id,
      boundary_at: session.boundary_at,
      baseline_capital: session.baseline_capital ?? session.balance_baseline,
      balance_amount: session.balance_amount,
    }));

    const scope = sessionPositionScope(session, 'p');
    const open = await client.query(`
      SELECT id, status, outcome, quantity, entry_price, opened_at
      FROM copied_positions p
      WHERE ${scope.clause} AND p.status IN ('open','closing')
      ORDER BY p.opened_at;
    `, scope.params);
    console.log('open algo positions (active sim session):', JSON.stringify(open.rows));
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
