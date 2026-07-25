/**
 * Compare optimize report builder output vs audit script totals.
 * Usage: npx tsx tools/_verify-optimize-report-api.ts
 */
import pg from 'pg';
import {
  buildCryptoAlgoOptimizeReport,
  type OptimizeReportExitAttemptRow,
  type OptimizeReportPositionInput,
  type OptimizeReportTickCoverageInput,
} from '../packages/core/src/crypto-algo/optimize-report.js';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const c = await pool.connect();
  try {
    const [positionRows, exitRows, tickRow, configRow, balRow] = await Promise.all([
      c.query(`
        SELECT p.id, p.status, p.close_reason, p.realized_pnl, p.entry_price,
               p.entry_bid_vwap, p.peak_closure_pnl_percent, p.opened_at, p.closed_at,
               m.slug AS market_slug
        FROM copied_positions p
        LEFT JOIN markets m ON m.condition_id = p.condition_id
        WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
      `),
      c.query(`
        SELECT e.kind, e.close_reason, e.block_reason, e.error, COUNT(*)::int AS count
        FROM exit_attempt_events e
        JOIN copied_positions p ON p.id = e.copied_position_id
        WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
        GROUP BY e.kind, e.close_reason, e.block_reason, e.error
        ORDER BY count DESC LIMIT 40
      `),
      c.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_total,
          COUNT(*) FILTER (WHERE status = 'closed' AND tick_n > 0)::int AS closed_with_ticks,
          ROUND(AVG(tick_n) FILTER (WHERE status = 'closed' AND tick_n > 0), 1) AS avg_ticks
        FROM (
          SELECT p.id, p.status, COUNT(t.*)::int AS tick_n
          FROM copied_positions p
          LEFT JOIN market_position_ticks t ON t.copied_position_id = p.id
          WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'
          GROUP BY p.id, p.status
        ) s
      `),
      c.query(`SELECT * FROM risk_config LIMIT 1`),
      c.query(`SELECT amount, baseline_capital FROM simulation_balances LIMIT 1`),
    ]);

    const config = configRow.rows[0];
    const balance = balRow.rows[0];

    const positions: OptimizeReportPositionInput[] = positionRows.rows.map(
      (row: Record<string, unknown>) => ({
        id: Number(row.id),
        status: String(row.status),
        closeReason: row.close_reason != null ? String(row.close_reason) : null,
        realizedPnl: Number(row.realized_pnl ?? 0),
        entryPrice: Number(row.entry_price ?? 0),
        entryBidVwap: Number(row.entry_bid_vwap ?? 0),
        peakClosurePnlPercent:
          row.peak_closure_pnl_percent != null
            ? Number(row.peak_closure_pnl_percent)
            : null,
        openedAt: row.opened_at as Date | null,
        closedAt: row.closed_at as Date | null,
        marketSlug: row.market_slug != null ? String(row.market_slug) : null,
      }),
    );

    const tickCoverage: OptimizeReportTickCoverageInput = {
      closedTotal: Number(tickRow.rows[0]?.closed_total ?? 0),
      closedWithTicks: Number(tickRow.rows[0]?.closed_with_ticks ?? 0),
      avgTicksWhenPresent:
        tickRow.rows[0]?.avg_ticks != null ? Number(tickRow.rows[0].avg_ticks) : null,
    };

    const exitAttempts: OptimizeReportExitAttemptRow[] = exitRows.rows.map(
      (r: Record<string, unknown>) => ({
        kind: String(r.kind),
        closeReason: String(r.close_reason),
        blockReason: r.block_reason != null ? String(r.block_reason) : null,
        error: r.error != null ? String(r.error) : null,
        count: Number(r.count),
      }),
    );

    const report = buildCryptoAlgoOptimizeReport({
      positions,
      config: {
        cryptoAlgoEnabled: Boolean(config.crypto_algo_enabled),
        cryptoAlgoStrategies: config.crypto_algo_strategies ?? null,
        cryptoAlgoSlEnabled: Boolean(config.crypto_algo_sl_enabled),
        cryptoAlgoTpEnabled: Boolean(config.crypto_algo_tp_enabled),
        cryptoAlgoTrailingEnabled: Boolean(config.crypto_algo_trailing_enabled),
        cryptoAlgoSlBidPoints: config.crypto_algo_sl_bid_points ?? null,
        cryptoAlgoTpBidPoints: config.crypto_algo_tp_bid_points ?? null,
        cryptoAlgoPreCloseEnabled: Boolean(config.crypto_algo_pre_close_enabled),
        cryptoAlgoPreCloseSeconds: config.crypto_algo_pre_close_seconds ?? null,
        cryptoAlgoTimeExitEnabled: Boolean(config.crypto_algo_time_exit_enabled),
        slConfirmationTicks: config.sl_confirmation_ticks ?? null,
        simEntryUsdcAmount: Number(config.sim_entry_usdc_amount ?? 0),
        simEntryShareCount: Number(config.sim_entry_share_count ?? 5),
        simSizingMode: String(config.sim_sizing_mode ?? 'fixed_usdc'),
      },
      balance: {
        cash: Number(balance?.amount ?? 0),
        baseline: Number(balance?.baseline_capital ?? 1000),
      },
      exitAttempts,
      tickCoverage,
    });

    console.log('=== BUILDER REPORT SUMMARY ===');
    console.log(
      JSON.stringify(
        {
          totals: report.totals,
          byCloseReason: report.byCloseReason.map((r) => ({
            close: r.closeReason,
            n: r.count,
            sumPnl: r.sumPnl,
          })),
          whipsaw: report.whipsaw,
          tickCoverage: report.tickCoverage,
          verdict: report.verdict.title,
          levers: report.levers.length,
        },
        null,
        2,
      ),
    );
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
