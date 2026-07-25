import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const REDEMPTION_LOSS_IDS = [16029, 16036];

async function analyzePosition(client: pg.PoolClient, posId: number) {
  const pos = (
    await client.query(
      `
      SELECT p.*, m.slug, m.end_date, m.resolved, m.accepting_orders, m.closed AS market_closed
      FROM copied_positions p
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.id = $1
    `,
      [posId],
    )
  ).rows[0];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`POSITION ${posId} � ${pos.slug}`);
  console.log(`${'='.repeat(70)}`);
  console.log({
    entry_price: pos.entry_price,
    entry_bid_vwap: pos.entry_bid_vwap,
    sl_percent: pos.sl_percent,
    peak_closure_pnl_percent: pos.peak_closure_pnl_percent,
    close_reason: pos.close_reason,
    realized_pnl: pos.realized_pnl,
    opened_at: pos.opened_at,
    closed_at: pos.closed_at,
    end_date: pos.end_date,
    accepting_orders: pos.accepting_orders,
  });

  const tickStats = (
    await client.query(
      `
      SELECT
        COUNT(*)::int AS tick_count,
        MIN(t.best_bid) AS min_best_bid,
        MAX(t.best_bid) AS max_best_bid,
        MIN(t.executable_bid_vwap) AS min_exec_bid,
        MAX(t.executable_bid_vwap) AS max_exec_bid,
        MIN(t.last_trade_price) AS min_last_trade,
        MAX(t.last_trade_price) AS max_last_trade,
        MIN(
          CASE WHEN $2::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - ($2::real + COALESCE($3::real,0)/NULLIF(COALESCE($4::real, $5::real),0))) /
             ($2::real + COALESCE($3::real,0)/NULLIF(COALESCE($4::real, $5::real),0))) * 100
          WHEN $6::real > 0 AND t.best_bid > 0 THEN
            ((t.best_bid - $6::real) / $6::real) * 100
          ELSE NULL END
        ) AS min_closure_pnl_pct,
        MIN(
          CASE WHEN $7::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - $7::real) / $7::real) * 100
          WHEN $7::real > 0 AND t.best_bid > 0 THEN
            ((t.best_bid - $7::real) / $7::real) * 100
          ELSE NULL END
        ) AS min_trigger_pnl_pct,
        MAX(
          CASE WHEN $2::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
            ((t.executable_bid_vwap - ($2::real + COALESCE($3::real,0)/NULLIF(COALESCE($4::real, $5::real),0))) /
             ($2::real + COALESCE($3::real,0)/NULLIF(COALESCE($4::real, $5::real),0))) * 100
          ELSE NULL END
        ) AS max_closure_pnl_pct
      FROM market_position_ticks t
      WHERE t.copied_position_id = $1
        AND t.created_at BETWEEN $8::timestamptz AND COALESCE($9::timestamptz, NOW())
    `,
      [
        posId,
        pos.entry_price,
        pos.entry_fees_remaining,
        pos.entry_quantity_remaining,
        pos.quantity,
        pos.entry_price,
        pos.entry_bid_vwap,
        pos.opened_at,
        pos.closed_at,
      ],
    )
  ).rows[0];

  console.log('\nTick stats during position life:');
  console.log(tickStats);

  const slThreshold = Number(pos.sl_percent);
  const slPriceTrigger =
    pos.entry_bid_vwap > 0
      ? pos.entry_bid_vwap * (1 - slThreshold / 100)
      : null;
  const slPriceClosure =
    pos.entry_price > 0
      ? pos.entry_price *
        (1 -
          slThreshold / 100 +
          (pos.entry_fees_remaining || 0) /
            (pos.entry_quantity_remaining || pos.quantity) /
            pos.entry_price)
      : null;

  console.log('\nSL thresholds (approx):', {
    sl_percent: slThreshold,
    trigger_bid_below: slPriceTrigger?.toFixed(4),
    closure_bid_below: slPriceClosure?.toFixed(4),
  });

  // Worst ticks near end of market
  const worstTicks = (
    await client.query(
      `
      SELECT t.created_at,
             EXTRACT(EPOCH FROM ($2::timestamptz - t.created_at))::int AS sec_to_end,
             t.best_bid, t.executable_bid_vwap, t.last_trade_price,
             CASE WHEN $3::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
               ((t.executable_bid_vwap - $3::real) / $3::real) * 100
             WHEN $3::real > 0 AND t.best_bid > 0 THEN
               ((t.best_bid - $3::real) / $3::real) * 100
             ELSE NULL END AS trigger_pnl_pct,
             CASE WHEN $4::real > 0 AND t.executable_bid_vwap IS NOT NULL THEN
               ((t.executable_bid_vwap - ($4::real + COALESCE($5::real,0)/NULLIF(COALESCE($6::real, $7::real),0))) /
                ($4::real + COALESCE($5::real,0)/NULLIF(COALESCE($6::real, $7::real),0))) * 100
             ELSE NULL END AS closure_pnl_pct
      FROM market_position_ticks t
      WHERE t.copied_position_id = $1
        AND t.created_at BETWEEN $8::timestamptz AND COALESCE($9::timestamptz, NOW())
      ORDER BY closure_pnl_pct ASC NULLS LAST
      LIMIT 8
    `,
      [
        posId,
        pos.end_date,
        pos.entry_bid_vwap,
        pos.entry_price,
        pos.entry_fees_remaining,
        pos.entry_quantity_remaining,
        pos.quantity,
        pos.opened_at,
        pos.closed_at,
      ],
    )
  ).rows;

  console.log('\nWorst 8 ticks (by closure PnL):');
  console.table(worstTicks);

  // Ticks in last 90s before endDate (TIME_EXIT window)
  const timeExitWindow = (
    await client.query(
      `
      SELECT t.created_at,
             EXTRACT(EPOCH FROM ($2::timestamptz - t.created_at))::int AS sec_to_end,
             t.best_bid, t.executable_bid_vwap, t.last_trade_price,
             CASE WHEN $3::real > 0 AND COALESCE(t.executable_bid_vwap, t.best_bid) IS NOT NULL THEN
               ((COALESCE(t.executable_bid_vwap, t.best_bid) - $3::real) / $3::real) * 100
             ELSE NULL END AS trigger_pnl_pct
      FROM market_position_ticks t
      WHERE t.copied_position_id = $1
        AND t.created_at >= ($2::timestamptz - interval '120 seconds')
        AND t.created_at <= COALESCE($4::timestamptz, NOW())
      ORDER BY t.created_at
      LIMIT 20
    `,
      [posId, pos.end_date, pos.entry_bid_vwap, pos.closed_at],
    )
  ).rows;

  console.log('\nTicks in last 120s before endDate (sample):');
  console.table(timeExitWindow);

  const execs = (
    await client.query(
      `SELECT id, side, status, reason, error, fill_price, realized_pnl, executed_at
       FROM executions WHERE copied_position_id = $1 ORDER BY id`,
      [posId],
    )
  ).rows;
  console.log('\nExecutions:', execs);

  // Ticks AFTER endDate until close
  const afterEnd = (
    await client.query(
      `
      SELECT t.created_at,
             EXTRACT(EPOCH FROM (t.created_at - $2::timestamptz))::int AS sec_after_end,
             t.best_bid, t.executable_bid_vwap, t.last_trade_price,
             CASE WHEN $3::real > 0 AND COALESCE(t.executable_bid_vwap, t.best_bid) IS NOT NULL THEN
               ((COALESCE(t.executable_bid_vwap, t.best_bid) - $3::real) / $3::real) * 100
             ELSE NULL END AS trigger_pnl_pct
      FROM market_position_ticks t
      WHERE t.copied_position_id = $1
        AND t.created_at > $2::timestamptz
      ORDER BY t.created_at
      LIMIT 15
    `,
      [posId, pos.end_date, pos.entry_bid_vwap],
    )
  ).rows;
  console.log('\nFirst ticks AFTER endDate:');
  console.table(afterEnd);

  const signals = (
    await client.query(
      `SELECT id, side, reason, status, error, created_at FROM order_signals
       WHERE copied_position_id = $1 ORDER BY created_at`,
      [posId],
    )
  ).rows;
  console.log('\nOrder signals:', signals.length ? signals : '(none)');

  const failedSells = (
    await client.query(
      `SELECT id, reason, status, error, executed_at FROM executions
       WHERE copied_position_id = $1 AND side = 'SELL' ORDER BY id`,
      [posId],
    )
  ).rows;
  console.log('\nAll SELL executions:', failedSells);
}

async function main() {
  const client = await pool.connect();
  try {
    const lossRedemption = (
      await client.query(`
        SELECT p.id FROM copied_positions p
        WHERE p.mode='sim' AND p.reason='ALGO_OPEN' AND p.close_reason='REDEMPTION' AND p.realized_pnl < 0
        ORDER BY p.id
      `)
    ).rows;

    console.log('REDEMPTION loss positions:', lossRedemption.map((r) => r.id));

    for (const row of lossRedemption) {
      await analyzePosition(client, row.id);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
