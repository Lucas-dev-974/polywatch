/**
 * Audit weather-algo : récupère en BDD toutes les positions WEATHER_OPEN,
 * leurs forecasts, exécutions, marchés, règles auto-track et config.
 *
 * Usage:
 *   npx tsx tools/weather-algo-audit.ts                 # humans lisible
 *   npx tsx tools/weather-algo-audit.ts --json          # JSON pour le canvas
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

type ForecastRow = {
  copied_position_id: number;
  city: string;
  target_date: string;
  metric: string;
  entry_forecast_mean: number;
  entry_forecast_std_dev: number;
  entry_model_values: string;
  entry_bucket_comparison: string | null;
  entry_bucket_bounds: string | null;
};

type ExecutionRow = {
  id: number;
  copied_position_id: number;
  mode: string;
  side: string;
  order_type: string | null;
  requested_qty: number | null;
  fill_price: number | null;
  fill_quantity: number | null;
  reference_vwap: number | null;
  slippage_percent: number | null;
  fees: number;
  realized_pnl: number;
  status: string;
  reason: string | null;
  executed_at: string | null;
};

type PositionRow = {
  id: number;
  watchlist_id: number;
  condition_id: string;
  asset_id: string;
  outcome: string;
  side: string;
  quantity: number;
  entry_price: number;
  entry_bid_vwap: number;
  entry_fees: number;
  entry_quantity_remaining: number | null;
  executable_bid_vwap: number | null;
  last_closeable_bid_vwap: number | null;
  last_closeable_bid_at: string | null;
  unrealized_pnl: number;
  realized_pnl: number;
  peak_closure_pnl_percent: number | null;
  closing_attempt_seq: number;
  liquidity_status: string;
  peak_bid_vwap: number | null;
  status: string;
  mode: string;
  opened_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  closing_reason: string | null;
  closing_started_at: string | null;
  increase_count: number;
  reason: string | null;
  forced_exit_failed_attempts: number;
  last_exit_block_reason: string | null;
  exit_emit_blocked_count: number;
  // market joins
  market_question: string | null;
  market_event_slug: string | null;
  market_end_date: string | null;
  market_closed: boolean;
  market_resolved: boolean;
  market_winning_token_id: string | null;
  market_outcomes: string;
  // forecast join
  forecast: ForecastRow | null;
};

type ConfigRow = Record<string, unknown>;

type AutoTrackRow = {
  id: number;
  city: string;
  metric: string;
  look_ahead_days: number;
  mode: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type ExitAttemptRow = {
  id: number;
  copied_position_id: number;
  mode: string;
  kind: string;
  close_reason: string | null;
  block_reason: string | null;
  error: string | null;
  execution_id: number | null;
  mark_bid: number | null;
  created_at: string;
};

type AuditData = {
  generatedAt: string;
  counts: {
    positions: number;
    forecasts: number;
    executions: number;
    exitAttempts: number;
    autoTrackRules: number;
  };
  positions: PositionRow[];
  executions: ExecutionRow[];
  exitAttempts: ExitAttemptRow[];
  autoTrackRules: AutoTrackRow[];
  weatherConfig: ConfigRow | null;
  statusBreakdown: Record<string, number>;
  modeBreakdown: Record<string, number>;
  closeReasonBreakdown: Record<string, number>;
  pnlBreakdown: {
    sim: { count: number; totalRealized: number; totalUnrealized: number; winners: number; losers: number };
    real: { count: number; totalRealized: number; totalUnrealized: number; winners: number; losers: number };
  };
};

async function main() {
  const json = process.argv.includes('--json');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();

  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    // 1. Positions WEATHER_OPEN + market + forecast
    const positions = (
      await c.query<Omit<PositionRow, 'forecast'> & { forecast_id: number | null }>(
        `
        SELECT
          p.id, p.watchlist_id, p.condition_id, p.asset_id, p.outcome, p.side,
          p.quantity, p.entry_price, p.entry_bid_vwap, p.entry_fees,
          p.entry_quantity_remaining, p.executable_bid_vwap,
          p.last_closeable_bid_vwap, p.last_closeable_bid_at::text AS last_closeable_bid_at,
          p.unrealized_pnl, p.realized_pnl, p.peak_closure_pnl_percent,
          p.closing_attempt_seq, p.liquidity_status, p.peak_bid_vwap,
          p.status, p.mode, p.opened_at::text AS opened_at,
          p.closed_at::text AS closed_at, p.close_reason, p.closing_reason,
          p.closing_started_at::text AS closing_started_at, p.increase_count,
          p.reason, p.forced_exit_failed_attempts, p.last_exit_block_reason,
          p.exit_emit_blocked_count,
          m.question AS market_question, m.event_slug AS market_event_slug,
          m.end_date::text AS market_end_date, m.closed AS market_closed,
          m.resolved AS market_resolved, m.winning_token_id AS market_winning_token_id,
          m.outcomes AS market_outcomes,
          wf.id AS forecast_id
        FROM copied_positions p
        LEFT JOIN markets m ON m.condition_id = p.condition_id
        LEFT JOIN weather_position_forecasts wf ON wf.copied_position_id = p.id
        WHERE p.reason = 'WEATHER_OPEN'
        ORDER BY p.opened_at DESC NULLS LAST
      `,
      )
    ).rows;

    // 2. Forecasts for these positions
    const positionIds = positions.map((p) => p.id);
    let forecasts: ForecastRow[] = [];
    if (positionIds.length) {
      forecasts = (
        await c.query<ForecastRow & { copied_position_id: number }>(
          `
          SELECT copied_position_id, city, target_date::text AS target_date, metric,
                 entry_forecast_mean, entry_forecast_std_dev, entry_model_values,
                 entry_bucket_comparison, entry_bucket_bounds
          FROM weather_position_forecasts
          WHERE copied_position_id = ANY($1::int[])
        `,
          [positionIds],
        )
      ).rows;
    }
    const forecastByPosition = new Map<number, ForecastRow>();
    for (const f of forecasts) forecastByPosition.set(f.copied_position_id, f);

    const fullPositions: PositionRow[] = positions.map((p) => {
      const { forecast_id, ...rest } = p as unknown as { forecast_id: number | null } & Omit<PositionRow, 'forecast'>;
      void forecast_id;
      return { ...rest, forecast: forecastByPosition.get(p.id) ?? null };
    });

    // 3. Executions for these positions
    let executions: ExecutionRow[] = [];
    if (positionIds.length) {
      executions = (
        await c.query<ExecutionRow>(
          `
          SELECT id, copied_position_id, mode, side, order_type,
                 requested_qty, fill_price, fill_quantity, reference_vwap,
                 slippage_percent, fees, realized_pnl, status, reason,
                 executed_at::text AS executed_at
          FROM executions
          WHERE copied_position_id = ANY($1::int[])
          ORDER BY copied_position_id, id
        `,
          [positionIds],
        )
      ).rows;
    }

    // 4. Exit attempt events
    let exitAttempts: ExitAttemptRow[] = [];
    if (positionIds.length) {
      exitAttempts = (
        await c.query<ExitAttemptRow>(
          `
          SELECT id, copied_position_id, mode, kind, close_reason, block_reason,
                 error, execution_id, mark_bid, created_at::text AS created_at
          FROM exit_attempt_events
          WHERE copied_position_id = ANY($1::int[])
          ORDER BY copied_position_id, created_at
        `,
          [positionIds],
        )
      ).rows;
    }

    // 5. Auto-track rules
    const autoTrackRules = (
      await c.query<AutoTrackRow>(
        `
        SELECT id, city, metric, look_ahead_days, mode, enabled,
               created_at::text AS created_at, updated_at::text AS updated_at
        FROM weather_auto_track_rules
        ORDER BY id
      `,
      )
    ).rows;

    // 6. Weather config (single row table)
    let weatherConfig: ConfigRow | null = null;
    try {
      const cfg = await c.query<ConfigRow>(`SELECT * FROM weather_config LIMIT 1`);
      weatherConfig = cfg.rows[0] ?? null;
    } catch {
      weatherConfig = null;
    }

    // 7. Breakdowns
    const statusBreakdown: Record<string, number> = {};
    const modeBreakdown: Record<string, number> = {};
    const closeReasonBreakdown: Record<string, number> = {};
    const pnlBreakdown = {
      sim: { count: 0, totalRealized: 0, totalUnrealized: 0, winners: 0, losers: 0 },
      real: { count: 0, totalRealized: 0, totalUnrealized: 0, winners: 0, losers: 0 },
    };

    for (const p of fullPositions) {
      statusBreakdown[p.status] = (statusBreakdown[p.status] ?? 0) + 1;
      modeBreakdown[p.mode] = (modeBreakdown[p.mode] ?? 0) + 1;
      if (p.close_reason) {
        closeReasonBreakdown[p.close_reason] = (closeReasonBreakdown[p.close_reason] ?? 0) + 1;
      }
      const bucket = pnlBreakdown[p.mode as 'sim' | 'real'];
      if (bucket) {
        bucket.count++;
        bucket.totalRealized += Number(p.realized_pnl) || 0;
        bucket.totalUnrealized += Number(p.unrealized_pnl) || 0;
        const total = (Number(p.realized_pnl) || 0) + (Number(p.unrealized_pnl) || 0);
        if (total > 0.0001) bucket.winners++;
        else if (total < -0.0001) bucket.losers++;
      }
    }

    const data: AuditData = {
      generatedAt: new Date().toISOString(),
      counts: {
        positions: fullPositions.length,
        forecasts: forecasts.length,
        executions: executions.length,
        exitAttempts: exitAttempts.length,
        autoTrackRules: autoTrackRules.length,
      },
      positions: fullPositions,
      executions,
      exitAttempts,
      autoTrackRules,
      weatherConfig,
      statusBreakdown,
      modeBreakdown,
      closeReasonBreakdown,
      pnlBreakdown,
    };

    if (json) {
      const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
      const payload = JSON.stringify(data, null, 2);
      if (out) {
        const fs = await import('node:fs/promises');
        await fs.writeFile(out, payload, 'utf8');
        console.log(`Wrote ${payload.length} bytes to ${out}`);
      } else {
        console.log(payload);
      }
      return;
    }

    // Humans lisible
    console.log(`\n=== Weather-Algo Audit — ${data.generatedAt} ===\n`);
    console.log(`Counts:`);
    console.log(`  positions     : ${data.counts.positions}`);
    console.log(`  forecasts     : ${data.counts.forecasts}`);
    console.log(`  executions    : ${data.counts.executions}`);
    console.log(`  exit attempts : ${data.counts.exitAttempts}`);
    console.log(`  auto-track    : ${data.counts.autoTrackRules}`);
    console.log(`\nStatus breakdown:`);
    for (const [k, v] of Object.entries(data.statusBreakdown)) console.log(`  ${k}: ${v}`);
    console.log(`\nMode breakdown:`);
    for (const [k, v] of Object.entries(data.modeBreakdown)) console.log(`  ${k}: ${v}`);
    console.log(`\nClose-reason breakdown:`);
    for (const [k, v] of Object.entries(data.closeReasonBreakdown)) console.log(`  ${k}: ${v}`);
    console.log(`\nPnL:`);
    for (const [mode, b] of Object.entries(data.pnlBreakdown)) {
      console.log(
        `  ${mode}: ${b.count} pos | realized=${b.totalRealized.toFixed(2)} | unrealized=${b.totalUnrealized.toFixed(2)} | W=${b.winners} L=${b.losers}`,
      );
    }
    console.log(`\nAuto-track rules:`);
    for (const r of data.autoTrackRules) {
      console.log(`  #${r.id} ${r.city} ${r.metric} look=${r.look_ahead_days}d enabled=${r.enabled}`);
    }
    console.log(`\nPositions (last 20):`);
    for (const p of data.positions.slice(0, 20)) {
      const fc = p.forecast ? `${p.forecast.city} μ=${p.forecast.entry_forecast_mean.toFixed(1)}σ=${p.forecast.entry_forecast_std_dev.toFixed(1)}` : 'no-forecast';
      console.log(
        `  #${p.id} ${p.mode} ${p.status} ${p.outcome} qty=${p.quantity.toFixed(2)} entry=${p.entry_price.toFixed(4)}` +
          ` PnL=${(Number(p.realized_pnl) + Number(p.unrealized_pnl)).toFixed(2)}` +
          ` ${p.close_reason ?? ''} | ${fc}`,
      );
    }
    if (weatherConfig) {
      console.log(`\nWeatherConfig (subset):`);
      for (const k of [
        'weather_algo_enabled',
        'weather_algo_sim_enabled',
        'weather_algo_real_enabled',
        'weather_algo_min_edge',
        'weather_algo_max_forecast_std',
        'weather_algo_poll_ms',
        'weather_algo_city_follow_switch_mode',
        'weather_algo_bucket_hysteresis_polls',
        'weather_algo_reentry_throttle_ms',
      ]) {
        if (k in weatherConfig) console.log(`  ${k}: ${weatherConfig[k]}`);
      }
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});