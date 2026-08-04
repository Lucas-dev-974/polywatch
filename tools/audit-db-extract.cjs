const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: 'postgresql://polywatch:polywatch@localhost:5432/polywatch',
});

async function main() {
  await client.connect();
  const out = {};

  // --- schema of archive tables ---
  const archCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sim_archive_positions' ORDER BY ordinal_position;
  `);
  out.archiveColumns = archCols.rows.map(r => r.column_name);

  // --- algo positions: current table ---
  const positions = await client.query(`
    SELECT p.*, w.address AS trader_address
    FROM copied_positions p
    LEFT JOIN watchlist_traders w ON w.id = p.watchlist_id
    WHERE p.reason IN ('ALGO_OPEN','ALGO_INCREASE')
    ORDER BY p.opened_at;
  `).catch(async () => {
    return client.query(`
      SELECT * FROM copied_positions WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') ORDER BY opened_at;
    `);
  });
  out.positions = positions.rows;

  // --- algo archive positions ---
  const hasReason = out.archiveColumns.includes('reason');
  const archive = await client.query(`
    SELECT * FROM sim_archive_positions ${hasReason ? "WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE')" : ''} ORDER BY opened_at;
  `);
  out.archivePositions = archive.rows;

  // --- executions for algo positions (current + by reason) ---
  const execs = await client.query(`
    SELECT e.* FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE p.reason IN ('ALGO_OPEN','ALGO_INCREASE')
    ORDER BY e.executed_at;
  `);
  out.executions = execs.rows;

  const execCols = out.archiveColumns.length
    ? await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='sim_archive_executions' ORDER BY ordinal_position;
      `)
    : { rows: [] };
  const archExecCols = execCols.rows.map(r => r.column_name);
  const archExecs = await client.query(`
    SELECT a.* FROM sim_archive_executions a
    JOIN sim_archive_positions p ON p.id = a.copied_position_id
    ${hasReason ? "WHERE p.reason IN ('ALGO_OPEN','ALGO_INCREASE')" : ''}
    ORDER BY a.executed_at;
  `).catch(e => ({ rows: [], error: e.message }));
  out.archiveExecutions = archExecs.rows;

  // --- close reason breakdown (current) ---
  const closeReasons = await client.query(`
    SELECT mode, close_reason, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           round(avg(realized_pnl)::numeric, 4) AS avg_pnl,
           round(min(realized_pnl)::numeric, 4) AS min_pnl,
           round(max(realized_pnl)::numeric, 4) AS max_pnl
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND status='closed'
    GROUP BY mode, close_reason ORDER BY mode, n DESC;
  `);
  out.closeReasons = closeReasons.rows;

  // --- per-outcome stats ---
  const byOutcome = await client.query(`
    SELECT mode, outcome, status, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           round(avg(realized_pnl)::numeric, 4) AS avg_pnl,
           round(avg(entry_price)::numeric, 4) AS avg_entry,
           round(avg(quantity*entry_price)::numeric, 2) AS avg_notional
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE')
    GROUP BY mode, outcome, status ORDER BY mode, outcome, status;
  `);
  out.byOutcome = byOutcome.rows;

  // --- duration stats (closed) ---
  const durations = await client.query(`
    SELECT mode,
           count(*)::int AS n,
           round(avg(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS avg_dur_s,
           round(min(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS min_dur_s,
           round(max(EXTRACT(EPOCH FROM (closed_at - opened_at)))::numeric, 0) AS max_dur_s
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND status='closed' AND closed_at IS NOT NULL
    GROUP BY mode;
  `);
  out.durations = durations.rows;

  // --- exit blocks ---
  const exitBlocks = await client.query(`
    SELECT mode, last_exit_block_reason, count(*)::int AS n
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND last_exit_block_reason IS NOT NULL
    GROUP BY mode, last_exit_block_reason ORDER BY n DESC;
  `);
  out.exitBlocks = exitBlocks.rows;

  // --- execution slippage / status ---
  const execStats = await client.query(`
    SELECT e.mode, e.side, e.status, e.reason, count(*)::int AS n,
           round(avg(e.slippage_percent)::numeric, 3) AS avg_slip,
           round(max(e.slippage_percent)::numeric, 3) AS max_slip,
           round(sum(e.fees)::numeric, 4) AS total_fees
    FROM executions e
    JOIN copied_positions p ON p.id = e.copied_position_id
    WHERE p.reason IN ('ALGO_OPEN','ALGO_INCREASE')
    GROUP BY e.mode, e.side, e.status, e.reason
    ORDER BY e.mode, e.side, n DESC;
  `);
  out.execStats = execStats.rows;

  // --- open/closing stuck positions ---
  const stuck = await client.query(`
    SELECT id, mode, status, condition_id, outcome, quantity, entry_price, opened_at,
           closing_started_at, close_reason, last_exit_block_reason, exit_emit_blocked_count,
           unrealized_pnl, liquidity_status
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND status IN ('open','closing')
    ORDER BY opened_at;
  `);
  out.stuckPositions = stuck.rows;

  // --- cancelled positions analysis ---
  const cancelled = await client.query(`
    SELECT mode, count(*)::int AS n,
           round(avg(quantity)::numeric,2) AS avg_qty,
           round(avg(entry_price)::numeric,4) AS avg_entry
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND status='cancelled'
    GROUP BY mode;
  `);
  out.cancelled = cancelled.rows;

  // --- crypto config snapshot ---
  const cfg = await client.query(`SELECT * FROM crypto_config ORDER BY id DESC LIMIT 1;`);
  out.cryptoConfig = cfg.rows[0] || null;

  // --- exit attempt events count ---
  const exitEvents = await client.query(`
    SELECT count(*)::int AS n FROM exit_attempt_events;
  `).catch(e => ({ rows: [{ n: 'n/a' }] }));
  out.exitAttemptEvents = exitEvents.rows[0];

  // --- archive close reasons (adapted to available columns) ---
  if (hasReason && out.archivePositions.length > 0) {
    const ac = out.archiveColumns;
    const where = ["reason IN ('ALGO_OPEN','ALGO_INCREASE')"];
    if (ac.includes('status')) where.push("status='closed'");
    else if (ac.includes('close_reason')) where.push('close_reason IS NOT NULL');
    const archClose = await client.query(`
      SELECT ${ac.includes('close_reason') ? 'close_reason,' : ''} count(*)::int AS n,
             ${ac.includes('realized_pnl') ? `round(sum(realized_pnl)::numeric, 4) AS total_pnl,
             round(avg(realized_pnl)::numeric, 4) AS avg_pnl` : 'NULL AS total_pnl, NULL AS avg_pnl'}
      FROM sim_archive_positions
      WHERE ${where.join(' AND ')}
      ${ac.includes('close_reason') ? 'GROUP BY close_reason ORDER BY n DESC' : ''};
    `).catch(e => ({ rows: [{ error: e.message }] }));
    out.archiveCloseReasons = archClose.rows;
  }

  // --- pnl time series (current closed, chronological) ---
  const series = await client.query(`
    SELECT closed_at::date AS day, mode,
           count(*)::int AS trades,
           round(sum(realized_pnl)::numeric, 4) AS day_pnl
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE') AND status='closed' AND closed_at IS NOT NULL
    GROUP BY closed_at::date, mode ORDER BY day;
  `);
  out.dailyPnl = series.rows;

  // --- condition_id concentration ---
  const concentration = await client.query(`
    SELECT condition_id, mode, count(*)::int AS n,
           round(sum(realized_pnl)::numeric, 4) AS total_pnl,
           min(opened_at) AS first_open, max(opened_at) AS last_open
    FROM copied_positions
    WHERE reason IN ('ALGO_OPEN','ALGO_INCREASE')
    GROUP BY condition_id, mode ORDER BY n DESC LIMIT 30;
  `);
  out.concentration = concentration.rows;

  fs.writeFileSync('tools/audit-db-data.json', JSON.stringify(out, null, 2));
  console.log('positions(current):', out.positions.length);
  console.log('positions(archive):', out.archivePositions.length);
  console.log('executions(current):', out.executions.length);
  console.log('executions(archive):', out.archiveExecutions.length);
  console.log('stuck open/closing:', out.stuckPositions.length);
  console.log('Written tools/audit-db-data.json');

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
