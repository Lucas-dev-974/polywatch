const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

async function main() {
  await client.connect();

  const breakdown = await client.query(`
    SELECT kind, close_reason, block_reason, error, mode, count(*)::int AS n
    FROM exit_attempt_events
    GROUP BY kind, close_reason, block_reason, error, mode
    ORDER BY n DESC;
  `);
  console.table(breakdown.rows);

  const perPos = await client.query(`
    SELECT copied_position_id, count(*)::int AS events,
           count(*) FILTER (WHERE kind='execution_failed')::int AS failed_execs,
           min(created_at) AS first_ev, max(created_at) AS last_ev
    FROM exit_attempt_events
    GROUP BY copied_position_id
    ORDER BY events DESC LIMIT 15;
  `);
  console.log('\ntop positions by exit events:');
  console.table(perPos.rows);

  // failed SL sells followed by eventual outcome
  const failedSl = await client.query(`
    SELECT e.copied_position_id, e.close_reason, e.error, e.created_at, e.mark_bid,
           p.status AS pos_status, p.close_reason AS pos_close_reason, p.realized_pnl, p.mode
    FROM exit_attempt_events e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE e.kind='execution_failed'
    ORDER BY e.created_at DESC LIMIT 20;
  `);
  console.log('\nfailed executions (recent):');
  console.table(failedSl.rows);

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
