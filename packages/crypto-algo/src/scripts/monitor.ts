import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const env = {
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  runId: process.env.CRYPTO_MONITOR_RUN_ID,
  intervalSeconds: Math.max(10, Number(process.env.CRYPTO_MONITOR_INTERVAL_SECONDS ?? 60)),
  durationHours: Math.max(1, Number(process.env.CRYPTO_MONITOR_DURATION_HOURS ?? 24)),
  outputDir: process.env.CRYPTO_MONITOR_OUTPUT_DIR ?? path.join(__dirname, '..', '..', 'monitoring'),
};

if (!env.databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!env.redisUrl) {
  console.error('REDIS_URL is required');
  process.exit(1);
}

const DATABASE_URL: string = env.databaseUrl;
const REDIS_URL: string = env.redisUrl;

const STARTED_AT = new Date();
const RUN_ID = env.runId ?? `crypto-algo-monitor-${STARTED_AT.toISOString().replace(/[:.]/g, '-')}`;

// ─────────────────────────────────────────────────────────────────────────────
// DB QUERIES (raw TypeORM)
// ─────────────────────────────────────────────────────────────────────────────

const SQL_SIGNALS_SNAPSHOT = `
  SELECT
    condition_id AS "conditionId",
    interval,
    last_signal_outcome AS "lastSignalOutcome",
    last_signal_confidence AS "lastSignalConfidence",
    last_signal_strategy_id AS "lastSignalStrategyId",
    last_abstain_reason AS "lastAbstainReason",
    up_price AS "upPrice",
    down_price AS "downPrice",
    up_spread_pct AS "upSpreadPct",
    down_spread_pct AS "downSpreadPct",
    ws_healthy AS "wsHealthy",
    open_positions_count AS "openPositionsCount",
    open_exposure_usd AS "openExposureUsd",
    unrealized_pnl AS "unrealizedPnl",
    recorded_at AS "recordedAt"
  FROM algo_price_ticks apt
  INNER JOIN (
    SELECT condition_id, MAX(recorded_at) AS max_recorded_at
    FROM algo_price_ticks
    WHERE recorded_at >= NOW() - INTERVAL '5 minutes'
    GROUP BY condition_id
  ) latest ON apt.condition_id = latest.condition_id AND apt.recorded_at = latest.max_recorded_at
  ORDER BY condition_id;
`;

const SQL_POSITIONS_AGG = (hours: number) => `
  SELECT
    cp.interval AS interval,
    cp.mode AS mode,
    cp.reason AS reason,
    cp.close_reason AS "closeReason",
    cp.closing_reason AS "closingReason",
    COUNT(*)::int AS count,
    SUM(cp.realized_pnl) AS "realizedPnl",
    SUM(cp.unrealized_pnl) AS "unrealizedPnl",
    AVG(cp.quantity * cp.entry_price) AS "avgNotional",
    AVG(cp.entry_price) AS "avgEntryPrice",
    AVG(cp.executable_bid_vwap) AS "avgCurrentBid"
  FROM copied_positions cp
  WHERE cp.reason LIKE 'ALGO_%'
    AND cp.opened_at >= NOW() - INTERVAL '${hours} hours'
  GROUP BY cp.interval, cp.mode, cp.reason, cp.close_reason, cp.closing_reason
  ORDER BY cp.interval, cp.mode;
`;

const SQL_POSITIONS_OPEN = `
  SELECT
    cp.condition_id AS "conditionId",
    cp.interval AS interval,
    cp.mode AS mode,
    cp.outcome AS outcome,
    cp.quantity AS quantity,
    cp.entry_price AS "entryPrice",
    cp.entry_bid_vwap AS "entryBidVwap",
    cp.executable_bid_vwap AS "executableBidVwap",
    cp.last_closeable_bid_vwap AS "lastCloseableBidVwap",
    cp.unrealized_pnl AS "unrealizedPnl",
    cp.realized_pnl AS "realizedPnl",
    cp.peak_closure_pnl_percent AS "peakClosurePnlPercent",
    cp.sl_bid_points AS "slBidPoints",
    cp.tp_bid_points AS "tpBidPoints",
    cp.trailing_bid_points AS "trailingBidPoints",
    cp.trailing_activation_bid_points AS "trailingActivationBidPoints",
    cp.reason AS reason,
    cp.liquidity_status AS "liquidityStatus",
    cp.opened_at AS "openedAt",
    m.end_date AS "endDate",
    m.question AS question
  FROM copied_positions cp
  LEFT JOIN markets m ON m.condition_id = cp.condition_id
  WHERE cp.reason LIKE 'ALGO_%'
    AND cp.status IN ('open', 'closing')
  ORDER BY cp.unrealized_pnl ASC;
`;

const SQL_POSITIONS_CLOSED = (hours: number) => `
  SELECT
    cp.interval AS interval,
    cp.mode AS mode,
    cp.outcome AS outcome,
    cp.close_reason AS "closeReason",
    cp.realized_pnl AS "realizedPnl",
    cp.entry_price AS "entryPrice",
    cp.entry_bid_vwap AS "entryBidVwap",
    cp.opened_at AS "openedAt",
    cp.closed_at AS "closedAt",
    m.question AS question
  FROM copied_positions cp
  LEFT JOIN markets m ON m.condition_id = cp.condition_id
  WHERE cp.reason LIKE 'ALGO_%'
    AND cp.status = 'closed'
    AND cp.closed_at >= NOW() - INTERVAL '${hours} hours'
  ORDER BY cp.closed_at DESC
  LIMIT 500;
`;

const SQL_EXIT_ATTEMPTS = `
  SELECT
    cp.condition_id AS "conditionId",
    cp.interval AS interval,
    cp.mode AS mode,
    cp.outcome AS outcome,
    cp.last_exit_block_close_reason AS "lastExitBlockCloseReason",
    cp.last_exit_block_reason AS "lastExitBlockReason",
    cp.exit_emit_blocked_count AS "exitEmitBlockedCount",
    cp.forced_exit_failed_attempts AS "forcedExitFailedAttempts",
    m.question AS question
  FROM copied_positions cp
  LEFT JOIN markets m ON m.condition_id = cp.condition_id
  WHERE cp.reason LIKE 'ALGO_%'
    AND cp.status IN ('open', 'closing')
    AND (cp.exit_emit_blocked_count > 0 OR cp.forced_exit_failed_attempts > 0)
  ORDER BY cp.exit_emit_blocked_count DESC, cp.forced_exit_failed_attempts DESC;
`;

const SQL_MARKET_ACTIVITY = (hours: number) => `
  SELECT
    condition_id AS "conditionId",
    interval,
    COUNT(*)::int AS "tickCount",
    COUNT(DISTINCT last_signal_outcome)::int AS "signalVariety",
    COUNT(DISTINCT last_abstain_reason)::int AS "abstainVariety",
    MAX(recorded_at) AS "lastTickAt",
    MIN(up_price) AS "upMin",
    MAX(up_price) AS "upMax",
    AVG(up_spread_pct) AS "avgUpSpreadPct",
    AVG(CASE WHEN ws_healthy THEN 1 ELSE 0 END) AS "wsHealthyRatio"
  FROM algo_price_ticks
  WHERE recorded_at >= NOW() - INTERVAL '${hours} hours'
  GROUP BY condition_id, interval
  ORDER BY tick_count DESC;
`;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SignalRow {
  conditionId: string;
  interval: string | null;
  lastSignalOutcome: string | null;
  lastSignalConfidence: number | null;
  lastSignalStrategyId: string | null;
  lastAbstainReason: string | null;
  upPrice: number | null;
  downPrice: number | null;
  upSpreadPct: number | null;
  downSpreadPct: number | null;
  wsHealthy: boolean | null;
  openPositionsCount: number;
  openExposureUsd: number | null;
  unrealizedPnl: number | null;
  recordedAt: Date;
}

interface PositionAggRow {
  interval: string | null;
  mode: string;
  reason: string;
  closeReason: string | null;
  closingReason: string | null;
  count: number;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  avgNotional: number | null;
  avgEntryPrice: number | null;
  avgCurrentBid: number | null;
}

interface OpenPositionRow {
  conditionId: string;
  interval: string | null;
  mode: string;
  outcome: string;
  quantity: number;
  entryPrice: number;
  entryBidVwap: number;
  executableBidVwap: number | null;
  lastCloseableBidVwap: number | null;
  unrealizedPnl: number;
  realizedPnl: number;
  peakClosurePnlPercent: number | null;
  slBidPoints: number | null;
  tpBidPoints: number | null;
  trailingBidPoints: number | null;
  trailingActivationBidPoints: number | null;
  reason: string;
  liquidityStatus: string;
  openedAt: Date;
  endDate: Date | null;
  question: string | null;
}

interface ClosedPositionRow {
  interval: string | null;
  mode: string;
  outcome: string;
  closeReason: string | null;
  realizedPnl: number;
  entryPrice: number;
  entryBidVwap: number;
  openedAt: Date;
  closedAt: Date;
  question: string | null;
}

interface ExitProblemRow {
  conditionId: string;
  interval: string | null;
  mode: string;
  outcome: string;
  lastExitBlockCloseReason: string | null;
  lastExitBlockReason: string | null;
  exitEmitBlockedCount: number;
  forcedExitFailedAttempts: number;
  question: string | null;
}

interface MarketActivityRow {
  conditionId: string;
  interval: string | null;
  tickCount: number;
  signalVariety: number;
  abstainVariety: number;
  lastTickAt: Date;
  upMin: number | null;
  upMax: number | null;
  avgUpSpreadPct: number | null;
  wsHealthyRatio: number | null;
}

interface RuntimeStatus {
  enabledSelections?: number;
  evaluableSelections?: number;
  wsConnected?: boolean;
  lastEvaluatedAt?: string | null;
  lastSkipReason?: string | null;
  lastSkipAt?: string | null;
}

interface Snapshot {
  ts: string;
  runtimeStatus: RuntimeStatus | null;
  signals: {
    totalConditions: number;
    wsHealthyRatio: number | null;
    byAbstainReason: Record<string, number>;
    bySignalOutcome: Record<string, number>;
    byInterval: Record<string, number>;
    avgConfidence: number | null;
  };
  positions: {
    openCount: number;
    closingCount: number;
    openExposureUsd: number;
    openUnrealizedPnl: number;
    byIntervalMode: Record<string, { count: number; realizedPnl: number; unrealizedPnl: number }>;
  };
  closed: {
    count: number;
    byCloseReason: Record<string, { count: number; pnl: number }>;
    winRate: number;
    avgPnl: number;
  };
  exitProblems: Array<{
    conditionId: string;
    interval: string | null;
    mode: string;
    outcome: string;
    blockedReason: string | null;
    blockedCloseReason: string | null;
    blockedCount: number;
    failedAttempts: number;
    question: string | null;
  }>;
  openPositions: Array<{
    conditionId: string;
    interval: string | null;
    mode: string;
    outcome: string;
    entryPrice: number | null;
    entryBidVwap: number | null;
    executableBidVwap: number | null;
    lastCloseableBidVwap: number | null;
    unrealizedPnl: number | null;
    peakClosurePnlPercent: number | null;
    slBidPoints: number | null;
    tpBidPoints: number | null;
    trailingBidPoints: number | null;
    trailingActivationBidPoints: number | null;
    liquidityStatus: string;
    reason: string;
    openedAt: Date;
    endDate: Date | null;
    question: string | null;
  }>;
  marketActivity: Array<{
    conditionId: string;
    interval: string | null;
    tickCount: number;
    signalVariety: number;
    abstainVariety: number;
    lastTickAt: Date;
    upMin: number | null;
    upMax: number | null;
    avgUpSpreadPct: number | null;
    wsHealthyRatio: number | null;
  }>;
  runSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function toFixed(n: number | null | undefined, digits = 4): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n.toFixed(digits));
}

function groupBy(rows: SignalRow[], key: keyof SignalRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const raw = row[key];
    const k = raw == null ? 'unknown' : String(raw);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4));
}

async function writeAtomicFile(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, data, 'utf8');
  await fs.rename(tmpPath, filePath);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN MONITOR LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ds = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    synchronize: false,
    logging: false,
  });

  await ds.initialize();
  const redis = new Redis(REDIS_URL);

  await fs.mkdir(env.outputDir, { recursive: true });

  let iteration = 0;
  const snapshots: Snapshot[] = [];
  const endAt = Date.now() + env.durationHours * 60 * 60 * 1000;

  console.log(`[crypto-algo-monitor] started run=${RUN_ID}`);
  console.log(`  outputDir=${env.outputDir}`);
  console.log(`  interval=${env.intervalSeconds}s duration=${env.durationHours}h`);

  while (Date.now() < endAt) {
    iteration += 1;
    const loopStart = Date.now();

    try {
      const [
        signalRows,
        positionAggRows,
        openPositionRows,
        closedPositionRows,
        exitAttemptRows,
        marketActivityRows,
        runtimeStatusRaw,
      ] = await Promise.all([
        ds.query(SQL_SIGNALS_SNAPSHOT) as Promise<SignalRow[]>,
        ds.query(SQL_POSITIONS_AGG(env.durationHours)) as Promise<PositionAggRow[]>,
        ds.query(SQL_POSITIONS_OPEN) as Promise<OpenPositionRow[]>,
        ds.query(SQL_POSITIONS_CLOSED(env.durationHours)) as Promise<ClosedPositionRow[]>,
        ds.query(SQL_EXIT_ATTEMPTS) as Promise<ExitProblemRow[]>,
        ds.query(SQL_MARKET_ACTIVITY(env.durationHours)) as Promise<MarketActivityRow[]>,
        redis.get('crypto-algo:runtime-status'),
      ]);

      const runtimeStatus: RuntimeStatus | null = runtimeStatusRaw
        ? (JSON.parse(runtimeStatusRaw) as RuntimeStatus)
        : null;

      const byAbstainReason = groupBy(signalRows, 'lastAbstainReason');
      const bySignalOutcome = groupBy(signalRows, 'lastSignalOutcome');
      const byInterval = groupBy(signalRows, 'interval');
      const confidences = signalRows
        .map((r) => r.lastSignalConfidence)
        .filter((c): c is number => c != null && !Number.isNaN(c));
      const wsHealthies = signalRows
        .map((r) => r.wsHealthy)
        .filter((h): h is boolean => h != null);
      const wsHealthyRatio = wsHealthies.length > 0
        ? Number((wsHealthies.filter(Boolean).length / wsHealthies.length).toFixed(2))
        : null;

      const openCount = openPositionRows.length;
      const closingCount = positionAggRows.reduce(
        (acc, p) => acc + (p.count > 0 && !p.closeReason ? p.count : 0),
        0,
      );
      const openExposureUsd = openPositionRows.reduce(
        (acc, p) => acc + p.entryPrice * p.quantity,
        0,
      );
      const openUnrealizedPnl = openPositionRows.reduce(
        (acc, p) => acc + p.unrealizedPnl,
        0,
      );

      const byIntervalMode: Snapshot['positions']['byIntervalMode'] = {};
      for (const row of positionAggRows) {
        const key = `${row.interval ?? 'unknown'}/${row.mode}`;
        const entry = byIntervalMode[key] ?? { count: 0, realizedPnl: 0, unrealizedPnl: 0 };
        entry.count += row.count;
        entry.realizedPnl += row.realizedPnl ?? 0;
        entry.unrealizedPnl += row.unrealizedPnl ?? 0;
        byIntervalMode[key] = entry;
      }

      const byCloseReason: Record<string, { count: number; pnl: number }> = {};
      let totalClosedPnl = 0;
      for (const row of closedPositionRows) {
        const key = row.closeReason ?? 'UNKNOWN';
        const entry = byCloseReason[key] ?? { count: 0, pnl: 0 };
        entry.count += 1;
        entry.pnl += row.realizedPnl;
        byCloseReason[key] = entry;
        totalClosedPnl += row.realizedPnl;
      }
      const winRate = closedPositionRows.length > 0
        ? Number(
            (
              closedPositionRows.filter((r) => r.realizedPnl > 0).length /
              closedPositionRows.length
            ).toFixed(2),
          )
        : 0;
      const avgPnl = closedPositionRows.length > 0
        ? Number((totalClosedPnl / closedPositionRows.length).toFixed(4))
        : 0;

      const snapshot: Snapshot = {
        ts: new Date().toISOString(),
        runtimeStatus,
        signals: {
          totalConditions: signalRows.length,
          wsHealthyRatio,
          byAbstainReason,
          bySignalOutcome,
          byInterval,
          avgConfidence: avg(confidences),
        },
        positions: {
          openCount,
          closingCount,
          openExposureUsd: Number(openExposureUsd.toFixed(2)),
          openUnrealizedPnl: Number(openUnrealizedPnl.toFixed(4)),
          byIntervalMode,
        },
        closed: {
          count: closedPositionRows.length,
          byCloseReason,
          winRate,
          avgPnl,
        },
        exitProblems: exitAttemptRows.map((r) => ({
          conditionId: r.conditionId,
          interval: r.interval,
          mode: r.mode,
          outcome: r.outcome,
          blockedReason: r.lastExitBlockReason,
          blockedCloseReason: r.lastExitBlockCloseReason,
          blockedCount: r.exitEmitBlockedCount,
          failedAttempts: r.forcedExitFailedAttempts,
          question: r.question,
        })),
        openPositions: openPositionRows.map((r) => ({
          conditionId: r.conditionId,
          interval: r.interval,
          mode: r.mode,
          outcome: r.outcome,
          entryPrice: toFixed(r.entryPrice),
          entryBidVwap: toFixed(r.entryBidVwap),
          executableBidVwap: toFixed(r.executableBidVwap),
          lastCloseableBidVwap: toFixed(r.lastCloseableBidVwap),
          unrealizedPnl: toFixed(r.unrealizedPnl),
          peakClosurePnlPercent: toFixed(r.peakClosurePnlPercent),
          slBidPoints: toFixed(r.slBidPoints),
          tpBidPoints: toFixed(r.tpBidPoints),
          trailingBidPoints: toFixed(r.trailingBidPoints),
          trailingActivationBidPoints: toFixed(r.trailingActivationBidPoints),
          liquidityStatus: r.liquidityStatus,
          reason: r.reason,
          openedAt: r.openedAt,
          endDate: r.endDate,
          question: r.question,
        })),
        marketActivity: marketActivityRows.map((r) => ({
          conditionId: r.conditionId,
          interval: r.interval,
          tickCount: r.tickCount,
          signalVariety: r.signalVariety,
          abstainVariety: r.abstainVariety,
          lastTickAt: r.lastTickAt,
          upMin: toFixed(r.upMin),
          upMax: toFixed(r.upMax),
          avgUpSpreadPct: toFixed(r.avgUpSpreadPct),
          wsHealthyRatio: toFixed(r.wsHealthyRatio),
        })),
        runSeconds: Math.round((Date.now() - STARTED_AT.getTime()) / 1000),
      };

      snapshots.push(snapshot);

      const snapshotPath = path.join(env.outputDir, `${RUN_ID}.json`);
      const outputJson = JSON.stringify(
        {
          meta: {
            runId: RUN_ID,
            startedAt: STARTED_AT.toISOString(),
            intervalSeconds: env.intervalSeconds,
            durationHours: env.durationHours,
            databaseUrl: DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
            redisUrl: REDIS_URL.replace(/:\/\/[^@]*@/, '://***@'),
          },
          latest: snapshot,
          history: snapshots,
        },
        null,
        2,
      );
      await writeAtomicFile(snapshotPath, outputJson);

      // Emit structured snapshot on stdout for backend live streaming
      console.log(`[snapshot] ${JSON.stringify(snapshot)}`);
      console.log(`[heartbeat] iteration #${iteration} ok`);

      // Console summary (humain)
      console.log(`\n[${snapshot.ts}] iteration #${iteration}`);
      console.log(
        `  signals: ${snapshot.signals.totalConditions} markets | ` +
          `wsHealthy=${snapshot.signals.wsHealthyRatio ?? 'n/a'} | ` +
          `avgConfidence=${snapshot.signals.avgConfidence ?? 'n/a'}`
      );
      console.log(
        `  positions: open=${snapshot.positions.openCount} | ` +
          `exposure=$${snapshot.positions.openExposureUsd} | ` +
          `unrealized=${snapshot.positions.openUnrealizedPnl}`
      );
      console.log(
        `  closed: ${snapshot.closed.count} | ` +
          `winRate=${snapshot.closed.winRate} | ` +
          `avgPnl=${snapshot.closed.avgPnl}`
      );
      if (Object.keys(snapshot.signals.byAbstainReason).length > 0) {
        const top = Object.entries(snapshot.signals.byAbstainReason)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        console.log(`  top abstain reasons: ${top}`);
      }
      if (snapshot.exitProblems.length > 0) {
        console.log(`  exit problems: ${snapshot.exitProblems.length} positions`);
      }
    } catch (err) {
      console.error(`[crypto-algo-monitor] iteration #${iteration} failed`, err);
    }

    const elapsed = Date.now() - loopStart;
    const wait = Math.max(0, env.intervalSeconds * 1000 - elapsed);
    await sleep(wait);
  }

  await ds.destroy();
  await redis.quit();
  console.log(`[crypto-algo-monitor] completed run=${RUN_ID}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN REPORT
// ─────────────────────────────────────────────────────────────────────────────

function buildMarkdownReport(snapshots: Snapshot[]): string {
  const latest = snapshots[snapshots.length - 1];

  const lines: string[] = [];
  lines.push(`# Crypto-Algo Monitoring Report`);
  lines.push(`**Run ID:** ${RUN_ID}`);
  lines.push(`**Started:** ${STARTED_AT.toISOString()}`);
  lines.push(`**Latest snapshot:** ${latest.ts}`);
  lines.push(`**Duration:** ${latest.runSeconds}s`);
  lines.push('');

  lines.push(`## Latest Snapshot Summary`);
  lines.push(`- Markets monitored: ${latest.signals.totalConditions}`);
  lines.push(`- WS healthy ratio: ${latest.signals.wsHealthyRatio ?? 'n/a'}`);
  lines.push(`- Open algo positions: ${latest.positions.openCount}`);
  lines.push(`- Open exposure USD: $${latest.positions.openExposureUsd}`);
  lines.push(`- Open unrealized PnL: ${latest.positions.openUnrealizedPnl}`);
  lines.push(`- Closed positions (window): ${latest.closed.count}`);
  lines.push(`- Closed win rate: ${latest.closed.winRate}`);
  lines.push(`- Closed avg PnL: ${latest.closed.avgPnl}`);
  lines.push('');

  lines.push(`### Signal / Abstain Breakdown`);
  lines.push('| Reason | Count |');
  lines.push('|--------|-------|');
  for (const [reason, count] of Object.entries(latest.signals.byAbstainReason).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`| ${reason} | ${count} |`);
  }
  if (Object.keys(latest.signals.byAbstainReason).length === 0) {
    lines.push(`| (no abstain reasons recorded) | 0 |`);
  }
  lines.push('');

  lines.push(`### Closed Positions by Close Reason`);
  lines.push('| Close Reason | Count | Total PnL | Avg PnL |');
  lines.push('|--------------|-------|-----------|---------|');
  for (const [reason, data] of Object.entries(latest.closed.byCloseReason).sort(
    (a, b) => b[1].count - a[1].count
  )) {
    const avg = data.count > 0 ? (data.pnl / data.count).toFixed(4) : '0';
    lines.push(`| ${reason} | ${data.count} | ${data.pnl.toFixed(4)} | ${avg} |`);
  }
  lines.push('');

  lines.push(`### Open Positions by Interval/Mode`);
  lines.push('| Interval/Mode | Count | Realized PnL | Unrealized PnL |');
  lines.push('|---------------|-------|--------------|----------------|');
  for (const [key, data] of Object.entries(latest.positions.byIntervalMode).sort()) {
    lines.push(
      `| ${key} | ${data.count} | ${data.realizedPnl.toFixed(4)} | ${data.unrealizedPnl.toFixed(4)} |`
    );
  }
  lines.push('');

  if (latest.exitProblems.length > 0) {
    lines.push(`### Exit Problems (${latest.exitProblems.length})`);
    lines.push('| Condition | Interval | Mode | Blocked Reason | Blocked Count | Failed Attempts |');
    lines.push('|-----------|----------|------|----------------|---------------|-------------------|');
    for (const p of latest.exitProblems.slice(0, 20)) {
      lines.push(
        `| ${p.conditionId} | ${p.interval ?? '-'} | ${p.mode} | ${p.blockedReason ?? '-'} | ${p.blockedCount} | ${p.failedAttempts} |`
      );
    }
    lines.push('');
  }

  lines.push(`### Market Activity`);
  lines.push('| Condition | Interval | Ticks | Signal Variety | Abstain Variety | Avg Spread % | WS Healthy |');
  lines.push('|-----------|----------|-------|----------------|-----------------|--------------|------------|');
  for (const m of latest.marketActivity.slice(0, 30)) {
    lines.push(
      `| ${m.conditionId} | ${m.interval ?? '-'} | ${m.tickCount} | ${m.signalVariety} | ${m.abstainVariety} | ${m.avgUpSpreadPct ?? '-'} | ${m.wsHealthyRatio ?? '-'} |`
    );
  }
  lines.push('');

  lines.push(`## Runtime Status`);
  lines.push('```json');
  lines.push(JSON.stringify(latest.runtimeStatus, null, 2));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

main().catch((err) => {
  console.error('[crypto-algo-monitor] fatal error', err);
  process.exit(1);
});
