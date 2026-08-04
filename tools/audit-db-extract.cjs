const { Client } = require('pg');
const fs = require('fs');
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

async function extractAllHistory(out) {
  out.auditScope = 'all_history';

  const archCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sim_archive_positions' ORDER BY ordinal_position;
  `);
  out.archiveColumns = archCols.rows.map(r => r.column_name);

  const positions = await client.query(`
    SELECT p.*, w.address AS trader_address
    FROM copied_positions p
    LEFT JOIN watchlist_traders w ON w.id = p.watchlist_id
    WHERE p.reason IN ${ALGO_REASONS_SQL}
    ORDER BY p.opened_at;
  `).catch(async () => client.query(`
    SELECT * FROM copied_positions WHERE reason IN ${ALGO_REASONS_SQL} ORDER BY opened_at;
  `));
  out.positions = positions.rows;

  const hasReason = out.archiveColumns.includes('reason');
  const archive = await client.query(`
    SELECT * FROM sim_archive_positions ${hasReason ? `WHERE reason IN ${ALGO_REASONS_SQL}` : ''} ORDER BY opened_at;
  `);
  out.archivePositions = archive.rows;

  const execs = await client.query(`
    SELECT e.* FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE p.reason IN ${ALGO_REASONS_SQL}
    ORDER BY e.executed_at;
  `);
  out.executions = execs.rows;

  const archExecs = await client.query(`
    SELECT a.* FROM sim_archive_executions a
    JOIN sim_archive_positions p ON p.id = a.copied_position_id
    ${hasReason ? `WHERE p.reason IN ${ALGO_REASONS_SQL}` : ''}
    ORDER BY a.executed_at;
  `).catch(() => ({ rows: [] }));
  out.archiveExecutions = archExecs.rows;

  const positionScopeSql = `reason IN ${ALGO_REASONS_SQL}`;

  out.closeReasons = (await client.query(`
    SELECT mode, close_reason, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           round(avg(realized_pnl)::numeric, 4) AS avg_pnl,
           round(min(realized_pnl)::numeric, 4) AS min_pnl,
           round(max(realized_pnl)::numeric, 4) AS max_pnl
    FROM copied_positions
    WHERE ${positionScopeSql} AND status='closed'
    GROUP BY mode, close_reason ORDER BY mode, n DESC;
  `)).rows;

  out.byOutcome = (await client.query(`
    SELECT mode, outcome, status, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           round(avg(realized_pnl)::numeric, 4) AS avg_pnl,
           round(avg(entry_price)::numeric, 4) AS avg_entry,
           round(avg(quantity*entry_price)::numeric, 2) AS avg_notional
    FROM copied_positions
    WHERE ${positionScopeSql}
    GROUP BY mode, outcome, status ORDER BY mode, outcome, status;
  `)).rows;

  out.durations = (await client.query(`
    SELECT mode, count(*)::int AS n,
           round(avg(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS avg_dur_s,
           round(min(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS min_dur_s,
           round(max(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS max_dur_s
    FROM copied_positions
    WHERE ${positionScopeSql} AND status='closed' AND closed_at IS NOT NULL
    GROUP BY mode;
  `)).rows;

  out.exitBlocks = (await client.query(`
    SELECT mode, last_exit_block_reason, count(*)::int AS n
    FROM copied_positions
    WHERE ${positionScopeSql} AND last_exit_block_reason IS NOT NULL
    GROUP BY mode, last_exit_block_reason ORDER BY n DESC;
  `)).rows;

  out.execStats = (await client.query(`
    SELECT e.mode, e.side, e.status, e.reason, count(*)::int AS n,
           round(avg(e.slippage_percent)::numeric, 3) AS avg_slip,
           round(max(e.slippage_percent)::numeric, 3) AS max_slip,
           round(sum(e.fees)::numeric, 4) AS total_fees
    FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE p.reason IN ${ALGO_REASONS_SQL}
    GROUP BY e.mode, e.side, e.status, e.reason
    ORDER BY e.mode, e.side, n DESC;
  `)).rows;

  out.stuckPositions = (await client.query(`
    SELECT id, mode, status, condition_id, outcome, quantity, entry_price, opened_at,
           closing_started_at, close_reason, last_exit_block_reason, exit_emit_blocked_count,
           unrealized_pnl, liquidity_status
    FROM copied_positions
    WHERE ${positionScopeSql} AND status IN ('open','closing')
    ORDER BY opened_at;
  `)).rows;

  out.cancelled = (await client.query(`
    SELECT mode, count(*)::int AS n,
           round(avg(quantity)::numeric,2) AS avg_qty,
           round(avg(entry_price)::numeric,4) AS avg_entry
    FROM copied_positions
    WHERE ${positionScopeSql} AND status='cancelled'
    GROUP BY mode;
  `)).rows;

  out.dailyPnl = (await client.query(`
    SELECT closed_at::date AS day, mode,
           count(*)::int AS trades,
           round(sum(realized_pnl)::numeric, 4) AS day_pnl
    FROM copied_positions
    WHERE ${positionScopeSql} AND status='closed' AND closed_at IS NOT NULL
    GROUP BY closed_at::date, mode ORDER BY day;
  `)).rows;

  out.concentration = (await client.query(`
    SELECT condition_id, mode, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           min(opened_at) AS first_open, max(opened_at) AS last_open
    FROM copied_positions
    WHERE ${positionScopeSql}
    GROUP BY condition_id, mode ORDER BY n DESC LIMIT 30;
  `)).rows;

  if (hasReason && out.archivePositions.length > 0) {
    const ac = out.archiveColumns;
    const where = [`reason IN ${ALGO_REASONS_SQL}`];
    if (ac.includes('status')) where.push("status='closed'");
    else if (ac.includes('close_reason')) where.push('close_reason IS NOT NULL');
    out.archiveCloseReasons = (await client.query(`
      SELECT ${ac.includes('close_reason') ? 'close_reason,' : ''} count(*)::int AS n,
             ${ac.includes('realized_pnl') ? `round(sum(realized_pnl)::numeric, 4) AS total_pnl,
             round(avg(realized_pnl)::numeric, 4) AS avg_pnl` : 'NULL AS total_pnl, NULL AS avg_pnl'}
      FROM sim_archive_positions
      WHERE ${where.join(' AND ')}
      ${ac.includes('close_reason') ? 'GROUP BY close_reason ORDER BY n DESC' : ''};
    `).catch(e => [{ error: e.message }])).rows;
  } else {
    out.archiveCloseReasons = [];
  }
}

async function extractActiveSimSession(out, session) {
  out.auditScope = 'active_sim_session';
  out.session = session;
  out.archiveColumns = [];
  out.archivePositions = [];
  out.archiveExecutions = [];
  out.archiveCloseReasons = [];

  const scope = sessionPositionScope(session, 'p');
  const boundary = scope.params[0];

  const positions = await client.query(`
    SELECT p.*, w.address AS trader_address
    FROM copied_positions p
    LEFT JOIN watchlist_traders w ON w.id = p.watchlist_id
    WHERE ${scope.clause}
    ORDER BY p.opened_at;
  `, scope.params).catch(async () => client.query(`
    SELECT * FROM copied_positions p
    WHERE ${scope.clause}
    ORDER BY p.opened_at;
  `, scope.params));
  out.positions = positions.rows;

  out.executions = (await client.query(`
    SELECT e.* FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE ${scope.clause}
    ORDER BY e.executed_at;
  `, scope.params)).rows;

  const posScope = `mode = 'sim' AND reason IN ${ALGO_REASONS_SQL} AND opened_at >= $1`;

  out.closeReasons = (await client.query(`
    SELECT close_reason, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           round(avg(realized_pnl)::numeric, 4) AS avg_pnl,
           round(min(realized_pnl)::numeric, 4) AS min_pnl,
           round(max(realized_pnl)::numeric, 4) AS max_pnl
    FROM copied_positions
    WHERE ${posScope} AND status='closed'
    GROUP BY close_reason ORDER BY n DESC;
  `, [boundary])).rows;

  out.byOutcome = (await client.query(`
    SELECT outcome, status, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           round(avg(realized_pnl)::numeric, 4) AS avg_pnl,
           round(avg(entry_price)::numeric, 4) AS avg_entry,
           round(avg(quantity*entry_price)::numeric, 2) AS avg_notional
    FROM copied_positions
    WHERE ${posScope}
    GROUP BY outcome, status ORDER BY outcome, status;
  `, [boundary])).rows;

  out.durations = (await client.query(`
    SELECT count(*)::int AS n,
           round(avg(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS avg_dur_s,
           round(min(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS min_dur_s,
           round(max(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS max_dur_s
    FROM copied_positions
    WHERE ${posScope} AND status='closed' AND closed_at IS NOT NULL;
  `, [boundary])).rows;

  out.exitBlocks = (await client.query(`
    SELECT last_exit_block_reason, count(*)::int AS n
    FROM copied_positions
    WHERE ${posScope} AND last_exit_block_reason IS NOT NULL
    GROUP BY last_exit_block_reason ORDER BY n DESC;
  `, [boundary])).rows;

  out.execStats = (await client.query(`
    SELECT e.side, e.status, e.reason, count(*)::int AS n,
           round(avg(e.slippage_percent)::numeric, 3) AS avg_slip,
           round(max(e.slippage_percent)::numeric, 3) AS max_slip,
           round(sum(e.fees)::numeric, 4) AS total_fees
    FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE ${scope.clause}
    GROUP BY e.side, e.status, e.reason
    ORDER BY e.side, n DESC;
  `, scope.params)).rows;

  out.stuckPositions = (await client.query(`
    SELECT id, status, condition_id, outcome, quantity, entry_price, opened_at,
           closing_started_at, close_reason, last_exit_block_reason, exit_emit_blocked_count,
           unrealized_pnl, liquidity_status
    FROM copied_positions
    WHERE ${posScope} AND status IN ('open','closing')
    ORDER BY opened_at;
  `, [boundary])).rows;

  out.cancelled = (await client.query(`
    SELECT count(*)::int AS n,
           round(avg(quantity)::numeric,2) AS avg_qty,
           round(avg(entry_price)::numeric,4) AS avg_entry
    FROM copied_positions
    WHERE ${posScope} AND status='cancelled';
  `, [boundary])).rows;

  out.dailyPnl = (await client.query(`
    SELECT closed_at::date AS day,
           count(*)::int AS trades,
           round(sum(realized_pnl)::numeric, 4) AS day_pnl
    FROM copied_positions
    WHERE ${posScope} AND status='closed' AND closed_at IS NOT NULL
    GROUP BY closed_at::date ORDER BY day;
  `, [boundary])).rows;

  out.concentration = (await client.query(`
    SELECT condition_id, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           min(opened_at) AS first_open, max(opened_at) AS last_open
    FROM copied_positions
    WHERE ${posScope}
    GROUP BY condition_id ORDER BY n DESC LIMIT 30;
  `, [boundary])).rows;

  out.exitAttemptEvents = (await client.query(`
    SELECT count(*)::int AS n
    FROM exit_attempt_events ea
    JOIN copied_positions p ON p.id = ea.copied_position_id
    WHERE ${scope.clause}
  `, scope.params).catch(() => ({ rows: [{ n: 'n/a' }] }))).rows[0];
}

async function main() {
  await client.connect();
  const out = {};

  if (opts.allHistory) {
    await extractAllHistory(out);
  } else {
    const session = await resolveActiveSimSession(client);
    await extractActiveSimSession(out, session);
  }

  if (out.exitAttemptEvents == null) {
    out.exitAttemptEvents = (await client.query(`
      SELECT count(*)::int AS n FROM exit_attempt_events;
    `).catch(() => ({ rows: [{ n: 'n/a' }] }))).rows[0];
  }

  const cfg = await client.query(`SELECT * FROM crypto_config ORDER BY id DESC LIMIT 1;`);
  out.cryptoConfig = cfg.rows[0] || null;

  fs.writeFileSync('tools/audit-db-data.json', JSON.stringify(out, null, 2));

  console.log('auditScope:', out.auditScope);
  if (out.session) {
    console.log('session_id:', out.session.session_id);
    console.log('session boundary:', out.session.boundary_at);
  }
  console.log('positions:', out.positions.length);
  console.log('positions(archive):', out.archivePositions.length);
  console.log('executions:', out.executions.length);
  console.log('stuck open/closing:', out.stuckPositions.length);
  console.log('Written tools/audit-db-data.json');
  if (!opts.allHistory) {
    console.log('Tip: pass --all-history to include sim_archive_positions and all modes.');
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
