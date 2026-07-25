/**
 * Audit BDD pour le marché / position id 20583 — pourquoi aucune position ouverte ?
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

const TARGET_ID = 20583;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function j(v: unknown) {
  return JSON.stringify(v, null, 2);
}

async function main() {
  const c = await pool.connect();
  try {
    console.log(`\n========== AUDIT ID ${TARGET_ID} ==========\n`);

    // 1. Identifier l'entité
    const pos = await c.query(
      `SELECT * FROM copied_positions WHERE id = $1`,
      [TARGET_ID],
    );
    const snap = await c.query(
      `SELECT * FROM algo_surveillance_snapshots WHERE id = $1`,
      [TARGET_ID],
    );
    const sel = await c.query(
      `SELECT * FROM algo_market_selections WHERE id = $1`,
      [TARGET_ID],
    );

    console.log('--- copied_positions ---');
    console.log(pos.rowCount ? j(pos.rows[0]) : 'NOT FOUND');

    console.log('\n--- algo_surveillance_snapshots ---');
    console.log(snap.rowCount ? j(snap.rows[0]) : 'NOT FOUND');

    console.log('\n--- algo_market_selections ---');
    console.log(sel.rowCount ? j(sel.rows[0]) : 'NOT FOUND');

    // Resolve conditionId from whichever entity matched
    let conditionId: string | null = null;
    let marketStartAt: Date | null = null;
    let marketEndAt: Date | null = null;

    if (pos.rowCount) {
      conditionId = pos.rows[0].condition_id;
    } else if (snap.rowCount) {
      conditionId = snap.rows[0].condition_id;
      marketStartAt = snap.rows[0].market_start_at;
      marketEndAt = snap.rows[0].market_end_at;
    } else if (sel.rowCount) {
      conditionId = sel.rows[0].condition_id;
    }

    if (!conditionId) {
      // Try position id as surveillance position reference
      const byPosRef = await c.query(
        `SELECT * FROM algo_surveillance_snapshots
         WHERE positions_json LIKE $1
         ORDER BY id DESC LIMIT 5`,
        [`%${TARGET_ID}%`],
      );
      console.log('\n--- surveillance snapshots referencing position id ---');
      console.log(j(byPosRef.rows));
      if (byPosRef.rowCount) {
        conditionId = byPosRef.rows[0].condition_id;
        marketStartAt = byPosRef.rows[0].market_start_at;
        marketEndAt = byPosRef.rows[0].market_end_at;
      }
    }

    if (!conditionId) {
      console.log('\n❌ Impossible de résoudre conditionId pour id', TARGET_ID);
      return;
    }

    console.log('\n--- RESOLVED conditionId ---');
    console.log(conditionId);

    // 2. Market row
    const market = await c.query(
      `SELECT condition_id, question, end_date, resolved, closed,
              accepting_orders, market_type, slug, token_id_yes, token_id_no, outcomes
       FROM markets WHERE condition_id = $1`,
      [conditionId],
    );
    console.log('\n--- markets ---');
    console.log(j(market.rows[0] ?? null));

    // 3. Surveillance snapshot for this condition
    const surv = await c.query(
      `SELECT * FROM algo_surveillance_snapshots WHERE condition_id = $1`,
      [conditionId],
    );
    console.log('\n--- surveillance snapshot ---');
    console.log(j(surv.rows[0] ?? null));
    if (surv.rowCount && !marketStartAt) {
      marketStartAt = surv.rows[0].market_start_at;
      marketEndAt = surv.rows[0].market_end_at;
    }

    // 4. All algo positions on this market
    const allPos = await c.query(
      `SELECT id, outcome, status, mode, quantity, entry_price, entry_bid_vwap,
              reason, opened_at, closed_at, close_reason, realized_pnl, unrealized_pnl, asset_id
       FROM copied_positions
       WHERE condition_id = $1 AND reason LIKE 'ALGO_%'
       ORDER BY id`,
      [conditionId],
    );
    console.log('\n--- all ALGO positions on market ---');
    console.log(j(allPos.rows));

    const posIds = allPos.rows.map((r: { id: number }) => r.id);
    if (posIds.length) {
      const execs = await c.query(
        `SELECT id, copied_position_id, status, error, reason, side,
                fill_quantity, fill_price, order_signal_id, executed_at
         FROM executions WHERE copied_position_id = ANY($1) ORDER BY id`,
        [posIds],
      );
      console.log('\n--- executions for algo positions ---');
      console.log(j(execs.rows));

      const resv = await c.query(
        `SELECT * FROM position_reservations WHERE copied_position_id = ANY($1) ORDER BY id`,
        [posIds],
      );
      console.log('\n--- reservations ---');
      console.log(j(resv.rows));
    }

    // 5. Price ticks — abstain reasons and yes price evolution
    const tickCols = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'algo_price_ticks' ORDER BY ordinal_position`,
    );
    console.log('\n--- algo_price_ticks columns ---');
    console.log(tickCols.rows.map((r: { column_name: string }) => r.column_name).join(', '));

    const ticks = await c.query(
      `SELECT id, recorded_at, up_price, down_price, up_bid, up_ask, down_bid, down_ask,
              up_spread_pct, down_spread_pct, up_ask_vwap, down_ask_vwap,
              up_liquidity_status, down_liquidity_status,
              last_abstain_reason, last_signal_outcome, last_signal_strategy_id,
              seconds_until_end, book_staleness_ms, ws_healthy, price_gap
       FROM algo_price_ticks
       WHERE condition_id = $1
       ORDER BY recorded_at
       LIMIT 500`,
      [conditionId],
    );
    console.log(`\n--- algo_price_ticks (${ticks.rowCount} rows) ---`);

    // Summarize abstain reasons
    const abstainCounts = new Map<string, number>();
    let signalCount = 0;
    const signals: unknown[] = [];
    for (const t of ticks.rows) {
      const reason = t.last_abstain_reason as string | null;
      if (reason) {
        const key = reason.split(':')[0];
        abstainCounts.set(key, (abstainCounts.get(key) ?? 0) + 1);
      }
      if (t.last_signal_outcome) {
        signalCount++;
        if (signals.length < 10) signals.push(t);
      }
    }
    console.log('Abstain reason counts:', j(Object.fromEntries(abstainCounts)));
    console.log('Signal ticks count:', signalCount);
    if (signals.length) console.log('Sample signal ticks:', j(signals));

    // Price range during window
    if (ticks.rowCount) {
      const yesPrices = ticks.rows
        .map((t: { up_price: number | null }) => t.up_price)
        .filter((p: number | null) => p != null) as number[];
      if (yesPrices.length) {
        console.log('YES price range:', {
          min: Math.min(...yesPrices),
          max: Math.max(...yesPrices),
          first: yesPrices[0],
          last: yesPrices[yesPrices.length - 1],
        });
      }
    }

    // Ticks where NO signal should have fired (yes < 0.45)
    const noCandidate = ticks.rows.filter(
      (t: { up_price: number | null }) => t.up_price != null && t.up_price < 0.45,
    );
    console.log(`\nTicks with yes_price < 0.45 (NO candidate): ${noCandidate.length}`);
    if (noCandidate.length > 0 && noCandidate.length <= 20) {
      console.log(j(noCandidate));
    } else if (noCandidate.length > 20) {
      console.log('First 5:', j(noCandidate.slice(0, 5)));
      console.log('Last 5:', j(noCandidate.slice(-5)));
    }

    // 6. Risk config
    const riskCols = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'risk_config' AND column_name LIKE 'crypto_algo%' OR column_name LIKE 'sim_%'
       ORDER BY column_name`,
    );
    const riskColList = riskCols.rows.map((r: { column_name: string }) => r.column_name);
    const risk = await c.query(
      `SELECT crypto_algo_enabled, crypto_algo_max_entries_per_window,
              crypto_algo_reentry_window_ms, crypto_algo_base_threshold,
              sim_max_open_positions, sim_cash_override
       FROM risk_config ORDER BY id DESC LIMIT 1`,
    );
    console.log('\n--- risk_config (crypto algo) ---');
    console.log(j(risk.rows[0]));

    // 7. Move events / order signals if any
    const moves = await c.query(
      `SELECT id, condition_id, event_type, detected_at, skip_reasons, processed
       FROM move_events
       WHERE condition_id = $1
       ORDER BY detected_at DESC LIMIT 10`,
      [conditionId],
    );
    console.log('\n--- move_events ---');
    console.log(j(moves.rows));

    // 8. Algo market selection status
    const selection = await c.query(
      `SELECT * FROM algo_market_selections WHERE condition_id = $1`,
      [conditionId],
    );
    console.log('\n--- algo_market_selection ---');
    console.log(j(selection.rows[0] ?? null));

    // 9. Timeline analysis: when was entry blocked by minTimeToClose?
    if (marketEndAt && risk.rows[0]) {
      const endMs = new Date(marketEndAt).getTime();
      const minTtc = risk.rows[0].crypto_algo_min_time_to_close;
      const buffer = risk.rows[0].crypto_algo_min_time_to_close_buffer_seconds ?? 30;
      // Default for 5m: max(120, 90) + 30 = 150s
      const blockSeconds = minTtc ?? 150;
      const blockStart = new Date(endMs - blockSeconds * 1000);
      console.log('\n--- minTimeToClose analysis ---');
      console.log({
        marketEndAt,
        blockSeconds,
        entriesBlockedAfter: blockStart.toISOString(),
        marketStartAt,
      });
    }

    // 10. Deep dive position 20579 + 20583 executions
    const deepEx = await c.query(
      `SELECT e.id, e.copied_position_id, e.status, e.error, e.reason, e.side,
              e.fill_quantity, e.fill_price, e.order_signal_id, e.executed_at,
              p.status AS pos_status
       FROM executions e
       JOIN copied_positions p ON p.id = e.copied_position_id
       WHERE e.copied_position_id IN (20579, 20583)
       ORDER BY e.id`,
    );
    console.log('\n--- executions 20579/20583 ---');
    console.log(j(deepEx.rows));

    const deepResv = await c.query(
      `SELECT * FROM position_reservations
       WHERE copied_position_id IN (20579, 20583)
          OR order_signal_id IN (
            SELECT order_signal_id FROM executions WHERE copied_position_id IN (20579, 20583)
          )
       ORDER BY id`,
    );
    console.log('\n--- reservations 20579/20583 ---');
    console.log(j(deepResv.rows));

    const firstTicks = await c.query(
      `SELECT recorded_at, up_price, down_price, last_abstain_reason,
              last_signal_outcome, seconds_until_end
       FROM algo_price_ticks WHERE condition_id = $1 ORDER BY recorded_at LIMIT 12`,
      [conditionId],
    );
    console.log('\n--- first 12 price ticks ---');
    console.log(j(firstTicks.rows));

    const reentry = await c.query(
      `SELECT MIN(recorded_at) AS first_at, COUNT(*)::int AS n
       FROM algo_price_ticks
       WHERE condition_id = $1 AND last_abstain_reason LIKE 're_entry_limit%'`,
      [conditionId],
    );
    console.log('\n--- re_entry_limit ---');
    console.log(j(reentry.rows[0]));

    console.log('\n========== END AUDIT ==========\n');
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
