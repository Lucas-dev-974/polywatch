/**
 * Pure helpers for strategy-cycle Prometheus snapshots.
 * Kept separate from StrategyProcessing so unit tests do not need DB/Redis mocks.
 */

export interface StrategyCyclePositionInput {
  status?: string | null;
  mode?: string | null;
  liquidityStatus?: string | null;
  executableBidVwap?: number | null;
  lastCloseableBidVwap?: number | null;
}

export interface StrategyCycleMetricsSnapshot {
  durationMs: number;
  positionsEvaluated: number;
  positionsOpen: number;
  positionsOpenByMode: Record<string, number>;
  positionsByStatus: Record<string, number>;
  illiquidPositions: number;
  spreadMean: number;
}

const EMPTY_OPEN_BY_MODE: Record<string, number> = { sim: 0, real: 0 };

/**
 * Build the strategy-cycle metrics payload from the open-like position set.
 *
 * - `positions_open` / `positions_open_by_mode` count **status === 'open' only**
 * - `positions_by_status` covers the full open-like evaluation set
 * - `spread_mean` = mean(|executableBidVwap − lastCloseableBidVwap| / mid)
 *   over liquid positions that have both VWAP fields
 * - Empty set → zeros with stable `sim`/`real` labels (avoids stale gauges)
 */
export function buildStrategyCycleMetricsSnapshot(
  positions: readonly StrategyCyclePositionInput[],
  durationMs: number,
): StrategyCycleMetricsSnapshot {
  if (positions.length === 0) {
    return {
      durationMs,
      positionsEvaluated: 0,
      positionsOpen: 0,
      positionsOpenByMode: { ...EMPTY_OPEN_BY_MODE },
      positionsByStatus: {},
      illiquidPositions: 0,
      spreadMean: 0,
    };
  }

  const positionsOpenByMode: Record<string, number> = { ...EMPTY_OPEN_BY_MODE };
  const positionsByStatus: Record<string, number> = {};
  let positionsOpen = 0;
  let illiquidCount = 0;
  let spreadSum = 0;
  let spreadCount = 0;

  for (const p of positions) {
    const status = p.status ?? 'unknown';
    positionsByStatus[status] = (positionsByStatus[status] ?? 0) + 1;

    if (p.liquidityStatus === 'illiquid') {
      illiquidCount++;
    }

    if (status === 'open') {
      positionsOpen++;
      const mode = p.mode ?? 'unknown';
      positionsOpenByMode[mode] = (positionsOpenByMode[mode] ?? 0) + 1;
    }

    if (
      p.liquidityStatus !== 'illiquid' &&
      p.executableBidVwap != null &&
      p.lastCloseableBidVwap != null
    ) {
      const mid = (p.executableBidVwap + p.lastCloseableBidVwap) / 2;
      if (mid > 0) {
        spreadSum +=
          Math.abs(p.executableBidVwap - p.lastCloseableBidVwap) / mid;
        spreadCount++;
      }
    }
  }

  return {
    durationMs,
    positionsEvaluated: positions.length,
    positionsOpen,
    positionsOpenByMode,
    positionsByStatus,
    illiquidPositions: illiquidCount,
    spreadMean: spreadCount > 0 ? spreadSum / spreadCount : 0,
  };
}

/** Exit reasons counted by P0 exit-event metrics (worker beginClose). */
export const METRICS_COUNTED_EXIT_REASONS = new Set([
  'SL',
  'TP',
  'TRAILING',
  'PRE_CLOSE_LOSS',
  'PRE_CLOSE_WIN',
  'WEATHER_PRE_CLOSE',
  'KILL_SWITCH',
]);

export function shouldRecordExitMetric(reason: string): boolean {
  return METRICS_COUNTED_EXIT_REASONS.has(reason);
}
