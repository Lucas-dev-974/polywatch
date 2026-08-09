/**
 * Audit de conformité des règles live de weather-algo (hors backtest).
 *
 * Vérifie en BDD que les positions / evaluation_log respectent les règles
 * réellement implémentées (pickBestEdgeBucket + edge dynamique), pas la doc
 * obsolète selectForecastAlignedBucket.
 *
 * Usage:
 *   npx tsx tools/weather-algo-rules-audit.ts
 *   npx tsx tools/weather-algo-rules-audit.ts --json
 *   npx tsx tools/weather-algo-rules-audit.ts --json --out tmp/weather-rules-audit.json
 */
import pg from 'pg';
import { loadMonorepoEnv } from '../packages/core/src/config/env.js';
import {
  calculateEdge,
  resolveDynamicMinEdge,
} from '../packages/core/src/weather/weather-edge.js';
import { computeMarketImpliedProbabilities } from '../packages/core/src/weather/forecast-distribution.js';
import {
  isForecastInBucket,
  type BucketBounds,
} from '../packages/core/src/weather/weather-exit-helpers.js';

loadMonorepoEnv();

type FindingSeverity = 'ok' | 'warn' | 'fail' | 'info';

type Finding = {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  count?: number;
  samples?: Array<Record<string, unknown>>;
};

type PositionAuditRow = {
  id: number;
  status: string;
  mode: string;
  outcome: string;
  side: string;
  entry_price: number;
  realized_pnl: number;
  unrealized_pnl: number;
  close_reason: string | null;
  opened_at: string | null;
  closed_at: string | null;
  city: string | null;
  target_date: string | null;
  metric: string | null;
  entry_forecast_mean: number | null;
  entry_forecast_std_dev: number | null;
  entry_bucket_comparison: string | null;
  entry_bucket_bounds: string | null;
  market_question: string | null;
  market_end_date: string | null;
};

function parseBounds(raw: string | null): BucketBounds | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BucketBounds;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function asComparison(
  raw: string | null,
): 'exact' | 'between' | 'or_below' | 'or_above' | null {
  if (raw === 'exact' || raw === 'between' || raw === 'or_below' || raw === 'or_above') {
    return raw;
  }
  return null;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const json = process.argv.includes('--json');
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const findings: Finding[] = [];

  try {
    await c.query(`SET TIME ZONE 'UTC'`);

    // --- Config ---
    const cfgRes = await c.query(`SELECT * FROM weather_config LIMIT 1`);
    const cfg = cfgRes.rows[0] as Record<string, unknown> | undefined;
    if (!cfg) {
      findings.push({
        id: 'cfg_missing',
        severity: 'fail',
        title: 'weather_config absent',
        detail: 'Aucune ligne weather_config — impossible de valider les seuils.',
      });
    }

    const minEdge = num(cfg?.weather_algo_min_edge, 0.1);
    const maxStd =
      cfg?.weather_algo_max_forecast_std == null
        ? null
        : num(cfg.weather_algo_max_forecast_std);
    const minForecastProb =
      cfg?.weather_algo_min_forecast_probability == null
        ? null
        : num(cfg.weather_algo_min_forecast_probability);
    const selectionMode = String(cfg?.weather_algo_selection_mode ?? 'single');
    const maxSignals = num(cfg?.weather_algo_max_signals_per_event, 3);
    const switchMode = String(cfg?.weather_algo_city_follow_switch_mode ?? 'close_and_reenter');
    const hysteresis = num(cfg?.weather_algo_bucket_hysteresis_polls, 2);
    const reentryMs = num(cfg?.weather_algo_reentry_throttle_ms, 1_800_000);
    const closeBeforeH = num(cfg?.weather_algo_close_before_resolution_hours, 1);
    const driftThreshold = num(cfg?.weather_algo_forecast_change_threshold, 2);

    findings.push({
      id: 'cfg_snapshot',
      severity: 'info',
      title: 'Config live (seuils stratégiques)',
      detail: JSON.stringify(
        {
          enabled: cfg?.weather_algo_enabled,
          sim: cfg?.weather_algo_sim_enabled,
          real: cfg?.weather_algo_real_enabled,
          minEdge,
          maxStd,
          minForecastProb,
          selectionMode,
          maxSignals,
          switchMode,
          hysteresis,
          reentryMs,
          closeBeforeH,
          driftThreshold,
          entryUsdc: cfg?.weather_algo_entry_usdc,
          maxOpen: cfg?.weather_algo_max_open_positions,
          slBid: cfg?.weather_algo_sl_bid_points,
          tpBid: cfg?.weather_algo_tp_bid_points,
          trailingBid: cfg?.weather_algo_trailing_bid_points,
        },
        null,
        2,
      ),
    });

    // --- Positions ---
    const posRes = await c.query<PositionAuditRow>(`
      SELECT
        p.id, p.status, p.mode, p.outcome, p.side,
        p.entry_price, p.realized_pnl, p.unrealized_pnl,
        p.close_reason, p.opened_at::text AS opened_at, p.closed_at::text AS closed_at,
        wf.city, wf.target_date::text AS target_date, wf.metric,
        wf.entry_forecast_mean, wf.entry_forecast_std_dev,
        wf.entry_bucket_comparison, wf.entry_bucket_bounds,
        m.question AS market_question, m.end_date::text AS market_end_date
      FROM copied_positions p
      LEFT JOIN weather_position_forecasts wf ON wf.copied_position_id = p.id
      LEFT JOIN markets m ON m.condition_id = p.condition_id
      WHERE p.reason = 'WEATHER_OPEN'
      ORDER BY p.opened_at DESC NULLS LAST
    `);
    const positions = posRes.rows;

    const statusBreakdown: Record<string, number> = {};
    const closeReasonBreakdown: Record<string, number> = {};
    const outcomeBreakdown: Record<string, number> = {};
    for (const p of positions) {
      statusBreakdown[p.status] = (statusBreakdown[p.status] ?? 0) + 1;
      outcomeBreakdown[p.outcome] = (outcomeBreakdown[p.outcome] ?? 0) + 1;
      if (p.close_reason) {
        closeReasonBreakdown[p.close_reason] =
          (closeReasonBreakdown[p.close_reason] ?? 0) + 1;
      }
    }

    findings.push({
      id: 'counts',
      severity: 'info',
      title: 'Volume positions WEATHER_OPEN',
      detail: `${positions.length} positions`,
      count: positions.length,
      samples: [
        { statusBreakdown, outcomeBreakdown, closeReasonBreakdown },
      ],
    });

    // R1 — BUY YES only
    const nonYes = positions.filter(
      (p) => p.outcome !== 'YES' || (p.side && p.side !== 'BUY'),
    );
    findings.push({
      id: 'r_buy_yes_only',
      severity: nonYes.length ? 'fail' : 'ok',
      title: 'Règle BUY YES uniquement',
      detail: nonYes.length
        ? `${nonYes.length} position(s) hors BUY YES`
        : 'Toutes les positions sont BUY YES',
      count: nonYes.length,
      samples: nonYes.slice(0, 10).map((p) => ({
        id: p.id,
        outcome: p.outcome,
        side: p.side,
      })),
    });

    // R2 — forecast snapshot present for non-cancelled filled positions
    const needForecast = positions.filter((p) =>
      ['open', 'closing', 'closed', 'pending'].includes(p.status),
    );
    const missingForecast = needForecast.filter((p) => p.city == null);
    findings.push({
      id: 'r_forecast_snapshot',
      severity: missingForecast.length ? 'warn' : 'ok',
      title: 'Snapshot WeatherPositionForecast présent',
      detail: missingForecast.length
        ? `${missingForecast.length}/${needForecast.length} positions actives/fermées sans forecast snapshot`
        : `Snapshot présent pour ${needForecast.length} positions pertinentes`,
      count: missingForecast.length,
      samples: missingForecast.slice(0, 10).map((p) => ({
        id: p.id,
        status: p.status,
      })),
    });

    // R3 — 1 position max par ville (open/pending/closing)
    const active = positions.filter((p) =>
      ['open', 'pending', 'closing'].includes(p.status),
    );
    const byCity = new Map<string, number[]>();
    for (const p of active) {
      const city = (p.city ?? `unknown#${p.id}`).trim().toLowerCase();
      const list = byCity.get(city) ?? [];
      list.push(p.id);
      byCity.set(city, list);
    }
    const multiCity = [...byCity.entries()].filter(([, ids]) => ids.length > 1);
    findings.push({
      id: 'r_one_per_city',
      severity: multiCity.length ? 'fail' : 'ok',
      title: 'Au plus 1 position active par ville',
      detail: multiCity.length
        ? `${multiCity.length} ville(s) avec >1 position active`
        : `${active.length} position(s) active(s), 1 max par ville respecté`,
      count: multiCity.length,
      samples: multiCity.slice(0, 15).map(([city, ids]) => ({ city, ids })),
    });

    // R4 — recomputed entry gates vs current config (approx: config may have changed)
    type GateSample = {
      id: number;
      city: string | null;
      entryPrice: number;
      forecastProb: number;
      edge: number;
      dynamicMinEdge: number;
      inBucketAtEntry: boolean;
      violations: string[];
    };
    const gateSamples: GateSample[] = [];
    const gateViolations: GateSample[] = [];
    let outOfBucketAtEntry = 0;
    let recomputedOk = 0;
    let recomputedSkipped = 0;

    for (const p of positions) {
      if (!['open', 'closed', 'closing'].includes(p.status)) continue;
      if (
        p.entry_forecast_mean == null ||
        p.entry_forecast_std_dev == null ||
        !p.entry_bucket_comparison
      ) {
        recomputedSkipped++;
        continue;
      }
      const comparison = asComparison(p.entry_bucket_comparison);
      const bounds = parseBounds(p.entry_bucket_bounds);
      if (!comparison || !bounds) {
        recomputedSkipped++;
        continue;
      }

      const { yesProb } = computeMarketImpliedProbabilities(
        bounds.target ?? null,
        comparison,
        p.entry_forecast_mean,
        p.entry_forecast_std_dev,
        bounds.low ?? null,
        bounds.high ?? null,
      );
      const yesPrice = num(p.entry_price);
      const edge = calculateEdge(yesProb, yesPrice);
      // hours unknown at entry → use 24h neutral time factor (conservative proxy)
      const dynamic = resolveDynamicMinEdge(
        p.entry_forecast_std_dev,
        24,
        minEdge,
      );
      const inBucket = isForecastInBucket(
        p.entry_forecast_mean,
        comparison,
        bounds,
      );
      if (!inBucket) outOfBucketAtEntry++;

      const violations: string[] = [];
      if (minForecastProb != null && yesProb < minForecastProb - 1e-6) {
        violations.push(
          `forecastProb=${yesProb.toFixed(4)} < min=${minForecastProb}`,
        );
      }
      if (maxStd != null && p.entry_forecast_std_dev > maxStd + 1e-6) {
        violations.push(
          `stdDev=${p.entry_forecast_std_dev.toFixed(2)} > max=${maxStd}`,
        );
      }
      // Strict live rule: edge > dynamicThreshold. With hours=24 proxy this may
      // under/over-estimate; flag only clear misses (edge <= base floor 0.05).
      if (edge <= 0.05 + 1e-6) {
        violations.push(
          `edge=${edge.toFixed(4)} <= floor(0.05) (proxy hours=24 dyn=${dynamic.toFixed(4)})`,
        );
      } else if (edge <= dynamic + 1e-6) {
        // soft warn via separate counter — still record
        violations.push(
          `edge=${edge.toFixed(4)} <= dynProxy=${dynamic.toFixed(4)} (hours=24; may be false positive if entry was near resolution)`,
        );
      }

      const sample: GateSample = {
        id: p.id,
        city: p.city,
        entryPrice: yesPrice,
        forecastProb: yesProb,
        edge,
        dynamicMinEdge: dynamic,
        inBucketAtEntry: inBucket,
        violations,
      };
      gateSamples.push(sample);
      if (violations.some((v) => !v.includes('may be false positive'))) {
        gateViolations.push(sample);
      }
      recomputedOk++;
    }

    findings.push({
      id: 'r_entry_gates_recomputed',
      severity: gateViolations.length ? 'fail' : 'ok',
      title: 'Gates entrée recomputés (forecastProb / std / edge floor)',
      detail:
        `${recomputedOk} positions recomputées, ${recomputedSkipped} skippées, ` +
        `${gateViolations.length} violation(s) nette(s) vs config actuelle ` +
        `(attention: config a pu changer depuis l'entrée)`,
      count: gateViolations.length,
      samples: gateViolations.slice(0, 20).map((s) => ({
        id: s.id,
        city: s.city,
        entryPrice: Number(s.entryPrice.toFixed(4)),
        forecastProb: Number(s.forecastProb.toFixed(4)),
        edge: Number(s.edge.toFixed(4)),
        dynProxy: Number(s.dynamicMinEdge.toFixed(4)),
        inBucket: s.inBucketAtEntry,
        violations: s.violations,
      })),
    });

    // R5 — live bucket selection is pickBestEdgeBucket, NOT forecast-aligned
    const withBucket = gateSamples.length;
    const pctOut =
      withBucket > 0 ? Math.round((1000 * outOfBucketAtEntry) / withBucket) / 10 : 0;
    findings.push({
      id: 'r_bucket_selection_live',
      severity: 'info',
      title: 'Sélection bucket live = best edge (pas forecast-aligned)',
      detail:
        `${outOfBucketAtEntry}/${withBucket} positions (${pctOut}%) ont un forecastMean ` +
        `HORS du bucket d'entrée au moment de l'entrée. C'est conforme à pickBestEdgeBucket ` +
        `(max edge), pas à selectForecastAlignedBucket (doc obsolète).`,
      count: outOfBucketAtEntry,
      samples: gateSamples
        .filter((s) => !s.inBucketAtEntry)
        .slice(0, 15)
        .map((s) => ({
          id: s.id,
          city: s.city,
          entryPrice: Number(s.entryPrice.toFixed(4)),
          forecastProb: Number(s.forecastProb.toFixed(4)),
          edge: Number(s.edge.toFixed(4)),
        })),
    });

    // Distribution entry price / forecast prob
    const priced = gateSamples.filter((s) => s.entryPrice > 0);
    if (priced.length) {
      const sortedPrice = [...priced].sort((a, b) => a.entryPrice - b.entryPrice);
      const sortedProb = [...priced].sort(
        (a, b) => a.forecastProb - b.forecastProb,
      );
      const median = <T>(arr: T[], pick: (x: T) => number) =>
        pick(arr[Math.floor(arr.length / 2)]!);
      findings.push({
        id: 'dist_entry_quality',
        severity: 'info',
        title: 'Distribution qualité entrée (recomputée)',
        detail: JSON.stringify(
          {
            n: priced.length,
            entryPrice: {
              min: Number(sortedPrice[0]!.entryPrice.toFixed(4)),
              median: Number(median(sortedPrice, (x) => x.entryPrice).toFixed(4)),
              max: Number(
                sortedPrice[sortedPrice.length - 1]!.entryPrice.toFixed(4),
              ),
            },
            forecastProb: {
              min: Number(sortedProb[0]!.forecastProb.toFixed(4)),
              median: Number(
                median(sortedProb, (x) => x.forecastProb).toFixed(4),
              ),
              max: Number(
                sortedProb[sortedProb.length - 1]!.forecastProb.toFixed(4),
              ),
            },
            pctEntryPriceBelow010: Number(
              (
                (100 * priced.filter((s) => s.entryPrice < 0.1).length) /
                priced.length
              ).toFixed(1),
            ),
            pctForecastProbBelow030: Number(
              (
                (100 * priced.filter((s) => s.forecastProb < 0.3).length) /
                priced.length
              ).toFixed(1),
            ),
            pctOutOfBucketAtEntry: pctOut,
          },
          null,
          2,
        ),
      });
    }

    // R6 — evaluation_log consistency (if table populated)
    let evalCount = 0;
    let signalCount = 0;
    let badSignals = 0;
    const abstainReasons: Record<string, number> = {};
    const badSignalSamples: Array<Record<string, unknown>> = [];
    try {
      const evalRes = await c.query<{
        id: number;
        decision: string;
        reason: string | null;
        edge: number | null;
        dynamic_min_edge: number | null;
        forecast_prob: number | null;
        strategy_id: string;
      }>(`
        SELECT id, decision, reason, edge, dynamic_min_edge, forecast_prob, strategy_id
        FROM weather_evaluation_log
        ORDER BY evaluated_at DESC
        LIMIT 50000
      `);
      evalCount = evalRes.rows.length;
      for (const row of evalRes.rows) {
        if (row.decision === 'signal') {
          signalCount++;
          const edge = row.edge;
          const dyn = row.dynamic_min_edge;
          const fp = row.forecast_prob;
          const problems: string[] = [];
          if (edge == null || dyn == null) {
            problems.push('missing edge/dyn');
          } else if (edge <= dyn + 1e-9) {
            problems.push(`edge ${edge} <= dyn ${dyn}`);
          }
          if (
            minForecastProb != null &&
            fp != null &&
            fp < minForecastProb - 1e-6
          ) {
            problems.push(`forecastProb ${fp} < min ${minForecastProb}`);
          }
          if (row.strategy_id !== 'weather-forecast') {
            problems.push(`unexpected strategy ${row.strategy_id}`);
          }
          if (problems.length) {
            badSignals++;
            if (badSignalSamples.length < 20) {
              badSignalSamples.push({ id: row.id, problems, edge, dyn, fp });
            }
          }
        } else if (row.reason) {
          abstainReasons[row.reason] = (abstainReasons[row.reason] ?? 0) + 1;
        }
      }
      findings.push({
        id: 'r_eval_log_signals',
        severity: badSignals ? 'fail' : evalCount === 0 ? 'warn' : 'ok',
        title: 'weather_evaluation_log — signaux vs seuils',
        detail:
          evalCount === 0
            ? 'Table vide / non peuplée — pas de preuve runtime des décisions'
            : `${signalCount} signals / ${evalCount} rows auditées ; ${badSignals} signal(s) incohérent(s)`,
        count: badSignals,
        samples: [
          { abstainReasonsTop: Object.entries(abstainReasons)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([reason, n]) => ({ reason, n })) },
          ...badSignalSamples,
        ],
      });
    } catch (err) {
      findings.push({
        id: 'r_eval_log_signals',
        severity: 'warn',
        title: 'weather_evaluation_log inaccessible',
        detail: String(err),
      });
    }

    // R7 — PnL / win rate (sim)
    const closedSim = positions.filter(
      (p) => p.status === 'closed' && p.mode === 'sim',
    );
    let winners = 0;
    let losers = 0;
    let realized = 0;
    for (const p of closedSim) {
      const pnl = num(p.realized_pnl);
      realized += pnl;
      if (pnl > 1e-4) winners++;
      else if (pnl < -1e-4) losers++;
    }
    findings.push({
      id: 'kpi_sim_closed',
      severity: 'info',
      title: 'KPI sim closed',
      detail: JSON.stringify(
        {
          closed: closedSim.length,
          winners,
          losers,
          winRatePct:
            closedSim.length > 0
              ? Number(((100 * winners) / closedSim.length).toFixed(2))
              : null,
          realizedPnl: Number(realized.toFixed(4)),
        },
        null,
        2,
      ),
    });

    // R8 — close reasons sanity vs switch mode
    if (switchMode === 'hold' && (closeReasonBreakdown['WEATHER_BUCKET_EXIT'] ?? 0) > 0) {
      findings.push({
        id: 'r_hold_no_bucket_exit',
        severity: 'fail',
        title: 'Mode hold ne doit pas produire WEATHER_BUCKET_EXIT',
        detail: `${closeReasonBreakdown['WEATHER_BUCKET_EXIT']} closes WEATHER_BUCKET_EXIT alors que switchMode=hold`,
        count: closeReasonBreakdown['WEATHER_BUCKET_EXIT'],
      });
    } else {
      findings.push({
        id: 'r_hold_no_bucket_exit',
        severity: 'ok',
        title: 'Cohérence switchMode / WEATHER_BUCKET_EXIT',
        detail: `switchMode=${switchMode}; WEATHER_BUCKET_EXIT=${closeReasonBreakdown['WEATHER_BUCKET_EXIT'] ?? 0}`,
      });
    }

    // R9 — operational notes on aggressive tunables
    if (selectionMode === 'multi' && maxSignals > 10) {
      findings.push({
        id: 'ops_multi_aggressive',
        severity: 'warn',
        title: 'Selection multi agressive',
        detail: `selectionMode=multi maxSignals=${maxSignals} — risque de churn / cancels élevé`,
      });
    }
    if (reentryMs < 60_000) {
      findings.push({
        id: 'ops_reentry_short',
        severity: 'warn',
        title: 'Re-entry throttle très court',
        detail: `reentryThrottleMs=${reentryMs} (<60s) — favorise les re-entrées immédiates après bucket/drift exit`,
      });
    }

    // Auto-track
    const rules = (
      await c.query<{
        id: number;
        city: string;
        metric: string;
        enabled: boolean;
        look_ahead_days: number;
      }>(`
        SELECT id, city, metric, enabled, look_ahead_days
        FROM weather_auto_track_rules
        ORDER BY id
      `)
    ).rows;
    findings.push({
      id: 'auto_track',
      severity: 'info',
      title: 'Règles auto-track',
      detail: `${rules.filter((r) => r.enabled).length}/${rules.length} enabled`,
      count: rules.length,
      samples: [
        {
          metrics: Object.entries(
            rules.reduce<Record<string, number>>((acc, r) => {
              acc[r.metric] = (acc[r.metric] ?? 0) + 1;
              return acc;
            }, {}),
          ).map(([metric, n]) => ({ metric, n })),
        },
      ],
    });

    const summary = {
      generatedAt: new Date().toISOString(),
      strategyId: 'weather-forecast',
      ok: findings.filter((f) => f.severity === 'ok').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      fail: findings.filter((f) => f.severity === 'fail').length,
      info: findings.filter((f) => f.severity === 'info').length,
      findings,
    };

    if (json) {
      const payload = JSON.stringify(summary, null, 2);
      if (outPath) {
        const fs = await import('node:fs/promises');
        await fs.mkdir(outPath.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
        await fs.writeFile(outPath, payload, 'utf8');
        console.log(`Wrote ${payload.length} bytes to ${outPath}`);
      } else {
        console.log(payload);
      }
      return;
    }

    console.log(`\n=== Weather-Algo Rules Audit — ${summary.generatedAt} ===`);
    console.log(
      `Strategy: weather-forecast | ok=${summary.ok} warn=${summary.warn} fail=${summary.fail} info=${summary.info}\n`,
    );
    for (const f of findings) {
      const tag = f.severity.toUpperCase().padEnd(4);
      console.log(`[${tag}] ${f.id} — ${f.title}`);
      console.log(`       ${f.detail.replace(/\n/g, '\n       ')}`);
      if (f.samples?.length) {
        console.log(
          `       samples: ${JSON.stringify(f.samples).slice(0, 500)}${JSON.stringify(f.samples).length > 500 ? '…' : ''}`,
        );
      }
      console.log('');
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
