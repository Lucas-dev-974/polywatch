/**
 * Audit fenêtre 16:25→16:30 — BTC/ETH/XRP/SOL 5m (historique surveillance)
 * Cause exacte par position : exec error, close_reason, reservation, slippage.
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

/** Snapshot ids for 2026-07-13 14:25→14:30 UTC (= 16:25→16:30 UTC+2) */
const SNAPSHOT_IDS = [11325, 11326, 11327, 11328];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const j = (v: unknown) => JSON.stringify(v, null, 2);

function extractPosIds(raw: unknown): number[] {
  let arr: unknown[] = [];
  try {
    if (typeof raw === 'string') arr = JSON.parse(raw);
    else if (Array.isArray(raw)) arr = raw;
  } catch {
    return [];
  }
  const ids: number[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    for (const key of ['id', 'positionId', 'copiedPositionId']) {
      const v = o[key];
      if (typeof v === 'number' && Number.isFinite(v)) ids.push(v);
      else if (typeof v === 'string' && /^\d+$/.test(v)) ids.push(Number(v));
    }
  }
  return ids;
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query(`SET TIME ZONE 'UTC'`);
    console.log('\n========== AUDIT FENÊTRE 16:25→16:30 (2026-07-13) ==========\n');

    const snaps = await c.query(
      `SELECT id, condition_id, crypto_symbol, interval,
              market_start_at::text AS market_start_at,
              market_end_at::text AS market_end_at,
              winning_outcome, positions_json
       FROM algo_surveillance_snapshots
       WHERE id = ANY($1)
       ORDER BY crypto_symbol`,
      [SNAPSHOT_IDS],
    );
    console.log(`--- surveillance snapshots (${snaps.rowCount}) ---`);
    console.log(j(snaps.rows.map((r) => ({
      id: r.id,
      crypto_symbol: r.crypto_symbol,
      market_start_at: r.market_start_at,
      market_end_at: r.market_end_at,
      winning_outcome: r.winning_outcome,
      condition_id: r.condition_id,
    }))));

    const allPosIds: number[] = [];
    for (const snap of snaps.rows) {
      const ids = extractPosIds(snap.positions_json);
      console.log(`\n[${snap.crypto_symbol}] positions_json:`, snap.positions_json);
      console.log('extracted ids:', ids);
      allPosIds.push(...ids);
    }

    const conditionIds = [...new Set(snaps.rows.map((r) => r.condition_id as string))];

    const livePos = await c.query(
      `SELECT p.id, p.condition_id, p.outcome, p.status, p.mode, p.quantity, p.entry_price,
              p.reason, p.opened_at::text AS opened_at, p.closed_at::text AS closed_at,
              p.close_reason, p.asset_id, p.entry_bid_vwap, m.question
       FROM copied_positions p
       LEFT JOIN markets m ON m.condition_id = p.condition_id
       WHERE p.condition_id = ANY($1)
         AND p.reason = 'ALGO_OPEN'
         AND p.mode = 'sim'
         AND (
           (p.opened_at >= TIMESTAMP '2026-07-13 14:24:00'
            AND p.opened_at <= TIMESTAMP '2026-07-13 14:35:00')
           OR p.id = ANY($2::int[])
         )
       ORDER BY p.id`,
      [conditionIds, allPosIds.length ? allPosIds : [-1]],
    );
    console.log(`\n--- copied_positions ALGO_OPEN sim (${livePos.rowCount}) ---`);
    console.log(j(livePos.rows));

    const posIds = [
      ...new Set([...allPosIds, ...livePos.rows.map((r) => Number(r.id))]),
    ].filter((n) => Number.isFinite(n) && n > 0);

    if (!posIds.length) {
      console.log('No position ids found.');
      return;
    }

    const execs = await c.query(
      `SELECT e.id, e.copied_position_id, e.status, e.error, e.reason, e.side, e.mode,
              e.fill_quantity, e.fill_price, e.reference_vwap, e.order_signal_id,
              e.executed_at::text AS executed_at, e.requested_qty, e.order_type
       FROM executions e
       WHERE e.copied_position_id = ANY($1)
       ORDER BY e.copied_position_id, e.id`,
      [posIds],
    );
    console.log(`\n--- executions (${execs.rowCount}) ---`);
    console.log(j(execs.rows));

    const slippageCfg = await c.query(
      `SELECT id, max_slippage_percent FROM risk_config ORDER BY id LIMIT 1`,
    );
    console.log('\n--- risk_config.max_slippage_percent ---');
    console.log(j(slippageCfg.rows[0]));
    const maxSlip = Number(slippageCfg.rows[0]?.max_slippage_percent ?? 2);

    for (const e of execs.rows) {
      if (e.error !== 'slippage_exceeded') continue;
      const fill = Number(e.fill_price);
      const ref = Number(e.reference_vwap);
      if (!Number.isFinite(fill) || !Number.isFinite(ref) || ref <= 0) {
        console.log(
          `\n[slippage pos=${e.copied_position_id} exec=${e.id}] cannot compute (fill=${e.fill_price} ref=${e.reference_vwap})`,
        );
        continue;
      }
      const pct = (Math.abs(fill - ref) / ref) * 100;
      console.log(
        `\n[slippage pos=${e.copied_position_id} exec=${e.id}] fill=${fill} ref=${ref} slippage%=${pct.toFixed(4)} max=${maxSlip} blocked=${pct > maxSlip}`,
      );
    }

    const resv = await c.query(
      `SELECT *
       FROM position_reservations
       WHERE copied_position_id = ANY($1)
       ORDER BY copied_position_id, id`,
      [posIds],
    );
    console.log(`\n--- reservations (${resv.rowCount}) ---`);
    console.log(j(resv.rows));

    console.log('\n========== RÉSUMÉ PAR POSITION ==========');
    for (const pos of livePos.rows) {
      const symbol =
        snaps.rows.find((s) => s.condition_id === pos.condition_id)?.crypto_symbol ?? '?';
      const posExecs = execs.rows.filter((e) => Number(e.copied_position_id) === Number(pos.id));
      const buy = posExecs.find((e) => e.side === 'BUY') ?? posExecs[0];
      let cause = 'INCONNUE';
      if (buy?.error === 'placing_orphan') {
        cause = 'WORKER ORPHELIN (placing_orphan) — BUY resté placing, janitor a finalisé failed';
      } else if (buy?.error === 'slippage_exceeded') {
        cause = 'SLIPPAGE GUARD — VWAP book trop loin du reference_vwap';
      } else if (buy?.status === 'placing') {
        cause = 'EN COURS placing — pas encore finalisé';
      } else if (buy?.status === 'filled') {
        cause = 'OK filled';
      } else if (!buy && pos.close_reason === 'reservation_expired') {
        cause = 'TTL réservation — signal jamais exécuté / worker trop lent';
      } else if (!buy && pos.status === 'pending') {
        cause = 'PENDING sans exec — signal encore en file ou jamais claimé';
      } else if (buy?.error) {
        cause = `EXEC ERROR: ${buy.error}`;
      } else if (pos.close_reason) {
        cause = `CLOSE: ${pos.close_reason}`;
      }

      console.log(
        `\n${symbol} #${pos.id} status=${pos.status} close_reason=${pos.close_reason ?? '—'}`,
      );
      console.log(
        `  outcome=${pos.outcome} qty=${pos.quantity} entry=${pos.entry_price} entryBidVwap=${pos.entry_bid_vwap} opened_at=${pos.opened_at}`,
      );
      if (buy) {
        console.log(
          `  BUY exec#${buy.id} status=${buy.status} error=${buy.error ?? '—'} fill=${buy.fill_price}/${buy.fill_quantity} refVwap=${buy.reference_vwap ?? '—'} reqQty=${buy.requested_qty}`,
        );
        console.log(`  signal=${buy.order_signal_id} executed_at=${buy.executed_at}`);
      } else {
        console.log('  BUY exec: AUCUNE');
      }
      console.log(`  => CAUSE: ${cause}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
