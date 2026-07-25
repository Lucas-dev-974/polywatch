/**
 * Detecte les opens algo dont le prix d'entree (entry_bid_vwap / fill_price)
 * ne correspond pas au carnet live a opened_at, mais a un etat de marche
 * N secondes plus tot — symptome du decalage finalize vs match sim
 * (opened_at = now du results-consumer, prix figes au simulateFill).
 *
 * Usage:
 *   npx tsx tools/detect-stale-entry-timestamps.ts
 *   npx tsx tools/detect-stale-entry-timestamps.ts --hours 6 --min-lag-sec 30
 *   npx tsx tools/detect-stale-entry-timestamps.ts --position 22300
 *   npx tsx tools/detect-stale-entry-timestamps.ts --json
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';

loadMonorepoEnv();

type Args = {
  hours: number;
  minLagSec: number;
  minPriceDelta: number;
  mode: 'sim' | 'real' | 'all';
  positionId: number | null;
  limit: number;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    hours: 12,
    minLagSec: 30,
    minPriceDelta: 0.15,
    mode: 'sim',
    positionId: null,
    limit: 50,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = argv[i + 1];
    if (a === '--hours' && next) {
      args.hours = Number(next);
      i++;
    } else if (a === '--min-lag-sec' && next) {
      args.minLagSec = Number(next);
      i++;
    } else if (a === '--min-price-delta' && next) {
      args.minPriceDelta = Number(next);
      i++;
    } else if (a === '--mode' && next && (next === 'sim' || next === 'real' || next === 'all')) {
      args.mode = next;
      i++;
    } else if (a === '--position' && next) {
      args.positionId = Number(next);
      i++;
    } else if (a === '--limit' && next) {
      args.limit = Number(next);
      i++;
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: npx tsx tools/detect-stale-entry-timestamps.ts [options]

Options:
  --hours N            Lookback window (default 12)
  --min-lag-sec N      Min seconds between hist match and opened_at (default 30)
  --min-price-delta N  Min |entry_bid - live_bid_at_open| (default 0.15)
  --mode sim|real|all  Position mode filter (default sim)
  --position ID        Audit a single position
  --limit N            Max findings to print (default 50)
  --json               Machine-readable output
`);
      process.exit(0);
    }
  }
  return args;
}

type Finding = {
  positionId: number;
  executionId: number | null;
  mode: string;
  outcome: string;
  conditionId: string;
  openedAt: string;
  entryBidVwap: number;
  fillPrice: number | null;
  referenceVwap: number | null;
  liveBidAtOpen: number | null;
  liveAskAtOpen: number | null;
  liveMidAtOpen: number | null;
  deltaEntryVsLiveBid: number | null;
  histMatchAt: string | null;
  histBid: number | null;
  histAsk: number | null;
  lagSec: number | null;
  severity: 'critical' | 'warning';
};

function isUpOutcome(outcome: string): boolean {
  const o = outcome.trim().toLowerCase();
  return o === 'yes' || o === 'up';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();

  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    const params: unknown[] = [];
    const where: string[] = [
      'p.opened_at IS NOT NULL',
      'p.entry_bid_vwap > 0',
      `p.reason = 'ALGO_OPEN'`,
    ];

    if (args.mode !== 'all') {
      params.push(args.mode);
      where.push(`p.mode = $${params.length}`);
    }
    if (args.positionId != null) {
      params.push(args.positionId);
      where.push(`p.id = $${params.length}`);
    } else {
      params.push(Math.max(1, args.hours));
      where.push(`p.opened_at >= NOW() - make_interval(hours => $${params.length})`);
    }

    const positions = (
      await c.query<{
        id: number;
        mode: string;
        outcome: string;
        condition_id: string;
        opened_at: string;
        entry_bid_vwap: number;
        entry_price: number;
        reason: string | null;
      }>(
        `
      SELECT p.id, p.mode, p.outcome, p.condition_id,
             p.opened_at::text AS opened_at,
             p.entry_bid_vwap, p.entry_price, p.reason
      FROM copied_positions p
      WHERE ${where.join('\n        AND ')}
      ORDER BY p.opened_at DESC
      LIMIT 500
    `,
        params,
      )
    ).rows;

    const findings: Finding[] = [];

    for (const pos of positions) {
      const up = isUpOutcome(pos.outcome);

      const live = (
        await c.query<{
          recorded_at: string;
          leg_bid: number | null;
          leg_ask: number | null;
          leg_mid: number | null;
          sec: string;
        }>(
          `
        SELECT recorded_at::text,
               ${up ? 'up_bid' : 'down_bid'} AS leg_bid,
               ${up ? 'up_ask' : 'down_ask'} AS leg_ask,
               ${up ? 'up_price' : 'down_price'} AS leg_mid,
               ROUND(EXTRACT(EPOCH FROM (recorded_at - $2::timestamp))::numeric, 2) AS sec
        FROM algo_price_ticks
        WHERE condition_id = $1
        ORDER BY ABS(EXTRACT(EPOCH FROM (recorded_at - $2::timestamp)))
        LIMIT 1
      `,
          [pos.condition_id, pos.opened_at],
        )
      ).rows[0];

      if (!live || live.leg_bid == null) continue;

      const entryBid = Number(pos.entry_bid_vwap);
      const liveBid = Number(live.leg_bid);
      const delta = Math.abs(entryBid - liveBid);
      if (delta < args.minPriceDelta) continue;

      const hist = (
        await c.query<{
          recorded_at: string;
          leg_bid: number | null;
          leg_ask: number | null;
          sec_before: string;
        }>(
          `
        SELECT recorded_at::text,
               ${up ? 'up_bid' : 'down_bid'} AS leg_bid,
               ${up ? 'up_ask' : 'down_ask'} AS leg_ask,
               ROUND(EXTRACT(EPOCH FROM ($2::timestamp - recorded_at))::numeric, 2) AS sec_before
        FROM algo_price_ticks
        WHERE condition_id = $1
          AND recorded_at <= $2::timestamp
          AND ${up ? 'up_bid' : 'down_bid'} IS NOT NULL
        ORDER BY ABS(${up ? 'up_bid' : 'down_bid'} - $3), recorded_at DESC
        LIMIT 1
      `,
          [pos.condition_id, pos.opened_at, entryBid],
        )
      ).rows[0];

      const lagSec = hist ? Number(hist.sec_before) : null;
      if (lagSec == null || lagSec < args.minLagSec) continue;

      const exec = (
        await c.query<{
          id: number;
          fill_price: number | null;
          reference_vwap: number | null;
        }>(
          `
        SELECT id, fill_price, reference_vwap
        FROM executions
        WHERE copied_position_id = $1 AND reason = 'ALGO_OPEN' AND status = 'filled'
        ORDER BY id
        LIMIT 1
      `,
          [pos.id],
        )
      ).rows[0];

      findings.push({
        positionId: pos.id,
        executionId: exec?.id ?? null,
        mode: pos.mode,
        outcome: pos.outcome,
        conditionId: pos.condition_id,
        openedAt: pos.opened_at,
        entryBidVwap: entryBid,
        fillPrice: exec?.fill_price != null ? Number(exec.fill_price) : Number(pos.entry_price),
        referenceVwap:
          exec?.reference_vwap != null ? Number(exec.reference_vwap) : null,
        liveBidAtOpen: liveBid,
        liveAskAtOpen: live.leg_ask != null ? Number(live.leg_ask) : null,
        liveMidAtOpen: live.leg_mid != null ? Number(live.leg_mid) : null,
        deltaEntryVsLiveBid: delta,
        histMatchAt: hist?.recorded_at ?? null,
        histBid: hist?.leg_bid != null ? Number(hist.leg_bid) : null,
        histAsk: hist?.leg_ask != null ? Number(hist.leg_ask) : null,
        lagSec,
        severity: lagSec >= 60 || delta >= 0.3 ? 'critical' : 'warning',
      });
    }

    findings.sort((a, b) => (b.lagSec ?? 0) - (a.lagSec ?? 0));
    const sliced = findings.slice(0, args.limit);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            scanned: positions.length,
            findings: sliced.length,
            thresholds: {
              hours: args.hours,
              minLagSec: args.minLagSec,
              minPriceDelta: args.minPriceDelta,
              mode: args.mode,
            },
            results: sliced,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `Scanned ${positions.length} ALGO_OPEN opens` +
        (args.positionId != null ? ` (position #${args.positionId})` : ` (last ${args.hours}h, mode=${args.mode})`),
    );
    console.log(
      `Thresholds: |entry-live_bid| >= ${args.minPriceDelta}, hist lag >= ${args.minLagSec}s`,
    );
    console.log(`Findings: ${sliced.length}${findings.length > sliced.length ? ` (of ${findings.length})` : ''}\n`);

    if (sliced.length === 0) {
      console.log('No stale entry-timestamp mismatches detected.');
      return;
    }

    for (const f of sliced) {
      const tag = f.severity === 'critical' ? 'CRITICAL' : 'WARNING';
      console.log(
        `[${tag}] #${f.positionId} ${f.mode} ${f.outcome}` +
          ` open=${f.openedAt}` +
          ` entryBid=${f.entryBidVwap.toFixed(4)} fill=${f.fillPrice?.toFixed(4) ?? 'n/a'}`,
      );
      console.log(
        `  live@open  bid=${f.liveBidAtOpen?.toFixed(4) ?? 'n/a'}` +
          ` ask=${f.liveAskAtOpen?.toFixed(4) ?? 'n/a'}` +
          ` mid=${f.liveMidAtOpen?.toFixed(4) ?? 'n/a'}` +
          `  Δentry=${f.deltaEntryVsLiveBid?.toFixed(4) ?? 'n/a'}`,
      );
      console.log(
        `  hist match ${f.histMatchAt}` +
          ` bid=${f.histBid?.toFixed(4) ?? 'n/a'} ask=${f.histAsk?.toFixed(4) ?? 'n/a'}` +
          `  lag=${f.lagSec?.toFixed(1)}s before opened_at`,
      );
      console.log(
        `  → likely simulateFill matched ~${Math.round(f.lagSec ?? 0)}s before results-consumer finalize` +
          ` (opened_at=now, executedAt from sim discarded)\n`,
      );
    }

    const critical = findings.filter((f) => f.severity === 'critical').length;
    const warning = findings.length - critical;
    console.log(`Summary: ${critical} critical, ${warning} warning`);
    if (critical > 0) process.exitCode = 2;
    else if (warning > 0) process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
