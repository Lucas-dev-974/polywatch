/** Shared helpers for crypto-algo DB audit scripts (active sim session scope). */

const ALGO_REASONS = ['ALGO_OPEN', 'ALGO_INCREASE'];
const ALGO_REASONS_SQL = "('ALGO_OPEN','ALGO_INCREASE')";

function parseArgs(argv) {
  return {
    allHistory: argv.includes('--all-history'),
  };
}

async function resolveActiveSimSession(client) {
  const res = await client.query(`
    SELECT s.id AS session_id,
           s.started_at,
           s.baseline_capital,
           s.status,
           s.ending_equity,
           s.ending_session_pnl,
           b.session_started_at,
           b.amount AS balance_amount,
           b.baseline_capital AS balance_baseline
    FROM simulation_sessions s
    JOIN simulation_balances b
      ON b.current_session_id = s.id
     AND b.algo_kind = 'crypto'
    WHERE s.algo_kind = 'crypto'
      AND s.status = 'active'
    LIMIT 1
  `);
  if (res.rows.length === 0) {
    throw new Error('No active crypto simulation session found in simulation_sessions / simulation_balances');
  }
  const row = res.rows[0];
  row.boundary_at = row.session_started_at || row.started_at;
  return row;
}

/** WHERE clause + params for copied_positions scoped to active crypto sim session. */
function sessionPositionScope(session, alias = 'p') {
  return {
    clause: `${alias}.mode = 'sim'
      AND ${alias}.reason IN ${ALGO_REASONS_SQL}
      AND ${alias}.opened_at >= $1`,
    params: [session.boundary_at],
  };
}

/** Positions filter for JSON post-processing (no DB). */
function isSessionSimPosition(p, session) {
  if (!session) return false;
  const boundary = session.boundary_at || session.session_started_at || session.started_at;
  return p.mode === 'sim'
    && ALGO_REASONS.includes(p.reason)
    && p.opened_at
    && new Date(p.opened_at) >= new Date(boundary);
}

module.exports = {
  ALGO_REASONS,
  ALGO_REASONS_SQL,
  parseArgs,
  resolveActiveSimSession,
  sessionPositionScope,
  isSessionSimPosition,
};
