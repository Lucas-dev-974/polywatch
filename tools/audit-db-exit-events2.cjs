const { Client } = require('pg');
const {
  ALGO_REASONS_SQL,
  parseArgs,
  resolveActiveSimSession,
} = require('./audit-db-session.cjs');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

const opts = parseArgs(process.argv.slice(2));

async function main() {
  await client.connect();

  let sessionParams = [];

  if (!opts.allHistory) {
    const session = await resolveActiveSimSession(client);
    sessionParams = [session.boundary_at];
    console.log('auditScope: active_sim_session');
    console.log('session_id:', session.session_id, 'boundary:', session.boundary_at);
  } else {
    console.log('auditScope: all_history');
  }

  const sessionClause = opts.allHistory ? '' : "AND p.mode = 'sim' AND p.opened_at >= $1";

  const breakdown = await client.query(`
    SELECT ea.kind, ea.close_reason, ea.block_reason, ea.error, ea.mode, count(*)::int AS n
    FROM exit_attempt_events ea
    JOIN copied_positions p ON p.id = ea.copied_position_id
    WHERE p.reason IN ${ALGO_REASONS_SQL}
      ${sessionClause}
    GROUP BY ea.kind, ea.close_reason, ea.block_reason, ea.error, ea.mode
    ORDER BY n DESC;
  `, opts.allHistory ? [] : sessionParams);
  console.table(breakdown.rows);

  const perPos = await client.query(`
    SELECT ea.copied_position_id, count(*)::int AS events,
           count(*) FILTER (WHERE ea.kind='execution_failed')::int AS failed_execs,
           min(ea.created_at) AS first_ev, max(ea.created_at) AS last_ev
    FROM exit_attempt_events ea
    JOIN copied_positions p ON p.id = ea.copied_position_id
    WHERE p.reason IN ${ALGO_REASONS_SQL}
      ${sessionClause}
    GROUP BY ea.copied_position_id
    ORDER BY events DESC LIMIT 15;
  `, opts.allHistory ? [] : sessionParams);
  console.log('\ntop positions by exit events:');
  console.table(perPos.rows);

  const failedSl = await client.query(`
    SELECT e.copied_position_id, e.close_reason, e.error, e.created_at, e.mark_bid,
           p.status AS pos_status, p.close_reason AS pos_close_reason, p.realized_pnl, p.mode
    FROM exit_attempt_events e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE e.kind='execution_failed'
      AND p.reason IN ${ALGO_REASONS_SQL}
      ${sessionClause}
    ORDER BY e.created_at DESC LIMIT 20;
  `, opts.allHistory ? [] : sessionParams);
  console.log('\nfailed executions (recent):');
  console.table(failedSl.rows);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
