import type { DataSource } from 'typeorm';
import { CryptoConfigService } from '../services/crypto-config.service.js';
import { SimulationService } from '../services/simulation.service.js';
import {
  buildCryptoAlgoOptimizeReport,
  type CryptoAlgoOptimizeReport,
  type OptimizeReportExitAttemptRow,
  type OptimizeReportPositionInput,
  type OptimizeReportTickCoverageInput,
} from './optimize-report.js';
import { computeCryptoAlgoConfigFingerprint } from './config-fingerprint.js';

export interface CryptoAlgoOptimizeReportFilters {
  closedFrom?: Date | null;
  closedTo?: Date | null;
}

export interface CryptoAlgoOptimizeReportWithMeta {
  report: CryptoAlgoOptimizeReport;
  configFingerprint: string;
}

interface PositionRow {
  id: number;
  status: string;
  close_reason: string | null;
  realized_pnl: string | number;
  entry_price: string | number;
  entry_bid_vwap: string | number;
  peak_closure_pnl_percent: string | number | null;
  opened_at: Date | null;
  closed_at: Date | null;
  market_slug: string | null;
}

interface ExitAttemptRow {
  kind: string;
  close_reason: string;
  block_reason: string | null;
  error: string | null;
  count: number;
}

interface TickCoverageRow {
  closed_total: number;
  closed_with_ticks: number;
  avg_ticks: string | number | null;
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

function mapPosition(row: PositionRow): OptimizeReportPositionInput {
  return {
    id: row.id,
    status: row.status,
    closeReason: row.close_reason,
    realizedPnl: toNum(row.realized_pnl),
    entryPrice: toNum(row.entry_price),
    entryBidVwap: toNum(row.entry_bid_vwap),
    peakClosurePnlPercent:
      row.peak_closure_pnl_percent != null
        ? toNum(row.peak_closure_pnl_percent)
        : null,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    marketSlug: row.market_slug,
  };
}

function buildPeriodClause(filters: CryptoAlgoOptimizeReportFilters): {
  positionSql: string;
  exitSql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const positionParts: string[] = [];
  const exitParts: string[] = [];

  if (filters.closedFrom) {
    params.push(filters.closedFrom);
    const idx = params.length;
    positionParts.push(
      `(p.status != 'closed' OR p.closed_at IS NULL OR p.closed_at >= $${idx})`,
    );
    exitParts.push(`e.created_at >= $${idx}`);
  }
  if (filters.closedTo) {
    params.push(filters.closedTo);
    const idx = params.length;
    positionParts.push(
      `(p.status != 'closed' OR p.closed_at IS NULL OR p.closed_at <= $${idx})`,
    );
    exitParts.push(`e.created_at <= $${idx}`);
  }

  const positionSql =
    positionParts.length > 0 ? ` AND ${positionParts.join(' AND ')}` : '';
  const exitSql = exitParts.length > 0 ? ` AND ${exitParts.join(' AND ')}` : '';
  return { positionSql, exitSql, params };
}

export async function loadCryptoAlgoOptimizeReport(
  ds: DataSource,
  filters: CryptoAlgoOptimizeReportFilters = {},
): Promise<CryptoAlgoOptimizeReportWithMeta> {
  const cryptoService = new CryptoConfigService(ds);
  const simulationService = new SimulationService(ds);
  const { positionSql, exitSql, params } = buildPeriodClause(filters);

  const [positionRows, exitRows, tickRow, config, snapshot] = await Promise.all([
    ds.query<PositionRow[]>(
      `
          SELECT p.id, p.status, p.close_reason, p.realized_pnl, p.entry_price,
                 p.entry_bid_vwap, p.peak_closure_pnl_percent, p.opened_at, p.closed_at,
                 m.slug AS market_slug
          FROM copied_positions p
          LEFT JOIN markets m ON m.condition_id = p.condition_id
          WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'${positionSql}
        `,
      params,
    ),
    ds.query<ExitAttemptRow[]>(
      `
          SELECT e.kind, e.close_reason, e.block_reason, e.error, COUNT(*)::int AS count
          FROM exit_attempt_events e
          JOIN copied_positions p ON p.id = e.copied_position_id
          WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'${positionSql}${exitSql}
          GROUP BY e.kind, e.close_reason, e.block_reason, e.error
          ORDER BY count DESC
          LIMIT 40
        `,
      params,
    ),
    ds.query<TickCoverageRow[]>(
      `
          SELECT
            COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_total,
            COUNT(*) FILTER (WHERE status = 'closed' AND tick_n > 0)::int AS closed_with_ticks,
            ROUND(AVG(tick_n) FILTER (WHERE status = 'closed' AND tick_n > 0), 1) AS avg_ticks
          FROM (
            SELECT p.id, p.status, COUNT(t.*)::int AS tick_n
            FROM copied_positions p
            LEFT JOIN market_position_ticks t ON t.copied_position_id = p.id
            WHERE p.mode = 'sim' AND p.reason = 'ALGO_OPEN'${positionSql}
            GROUP BY p.id, p.status
          ) s
        `,
      params,
    ),
    cryptoService.getConfig(),
    simulationService.getSnapshot('crypto'),
  ]);

  const tickCoverage: OptimizeReportTickCoverageInput = {
    closedTotal: tickRow[0]?.closed_total ?? 0,
    closedWithTicks: tickRow[0]?.closed_with_ticks ?? 0,
    avgTicksWhenPresent:
      tickRow[0]?.avg_ticks != null ? toNum(tickRow[0].avg_ticks) : null,
  };

  const exitAttempts: OptimizeReportExitAttemptRow[] = exitRows.map((r) => ({
    kind: r.kind,
    closeReason: r.close_reason,
    blockReason: r.block_reason,
    error: r.error,
    count: r.count,
  }));

  const configInput = {
    cryptoAlgoEnabled: config.cryptoAlgoEnabled,
    cryptoAlgoStrategies: config.cryptoAlgoStrategies,
    cryptoAlgoSlEnabled: config.cryptoAlgoSlEnabled,
    cryptoAlgoTpEnabled: config.cryptoAlgoTpEnabled,
    cryptoAlgoTrailingEnabled: config.cryptoAlgoTrailingEnabled,
    cryptoAlgoSlPercent: config.cryptoAlgoSlPercent ?? null,
    cryptoAlgoTpPercent: config.cryptoAlgoTpPercent ?? null,
    cryptoAlgoTrailingPercent: config.cryptoAlgoTrailingPercent ?? null,
    cryptoAlgoTrailingActivationPercent:
      config.cryptoAlgoTrailingActivationPercent ?? null,
    cryptoAlgoPreCloseEnabled: config.cryptoAlgoPreCloseEnabled ?? false,
    cryptoAlgoPreCloseSeconds: config.cryptoAlgoPreCloseSeconds ?? null,
    cryptoAlgoPreCloseKeepEnabled: config.cryptoAlgoPreCloseKeepEnabled ?? null,
    cryptoAlgoPreCloseKeepBidThreshold: config.cryptoAlgoPreCloseKeepBidThreshold ?? null,
    slConfirmationTicks: config.cryptoAlgoSlConfirmationTicks ?? null,
    cryptoAlgoBaseThreshold: config.cryptoAlgoBaseThreshold ?? null,
    cryptoAlgoSizingMode: config.cryptoAlgoSizingMode,
    cryptoAlgoEntryPusdAmount: config.cryptoAlgoEntryPusdAmount,
    cryptoAlgoEntryShareCount: config.cryptoAlgoEntryShareCount ?? null,
    simEntryPusdAmount: 0,
    simEntryShareCount: 0,
    simSizingMode: 'fixed_pusd',
  };

  const report = buildCryptoAlgoOptimizeReport({
    positions: positionRows.map(mapPosition),
    config: configInput,
    balance: {
      cash: snapshot.amount,
      baseline: snapshot.baselineCapital,
    },
    exitAttempts,
    tickCoverage,
  });

  return {
    report,
    configFingerprint: computeCryptoAlgoConfigFingerprint(configInput),
  };
}
