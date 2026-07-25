import { Counter, Gauge, Histogram, type Registry } from 'prom-client';

export interface AppMetrics {
  positionsOpen: Gauge<string>;
  positionsOpenByMode: Gauge<string>;
  positionsByStatus: Gauge<string>;
  slFiredTotal: Counter<string>;
  tpFiredTotal: Counter<string>;
  trailingFiredTotal: Counter<string>;
  preCloseTotal: Counter<string>;
  killSwitchTotal: Counter<string>;
  spreadMean: Gauge<string>;
  clobFetchDuration: Histogram<string>;
  clobErrorsTotal: Counter<string>;
  dataApiFetchDuration: Histogram<string>;
  dataApiErrorsTotal: Counter<string>;
  circuitBreakerOpen: Gauge<string>;
  wsReconnectTotal: Counter<string>;
  strategyEvalDuration: Histogram<string>;
  strategyEvalPositions: Gauge<string>;
  illiquidPositions: Gauge<string>;
  redemptionTotal: Counter<string>;
  redemptionPayoffTotal: Counter<string>;
  snapshotCreatedTotal: Counter<string>;
  snapshotCount: Gauge<string>;
  snapshotPurgeTotal: Counter<string>;
  apiRouteDuration: Histogram<string>;
  workerMetricsLastPushTimestamp: Gauge<string>;
}

export function createAppMetrics(registry: Registry): AppMetrics {
  const prefix = 'polywatch_';

  return {
    positionsOpen: new Gauge({
      name: `${prefix}positions_open`,
      help: 'Number of currently open positions (status = open)',
      registers: [registry],
    }),
    positionsOpenByMode: new Gauge({
      name: `${prefix}positions_open_by_mode`,
      help: 'Number of open positions by trading mode',
      labelNames: ['mode'],
      registers: [registry],
    }),
    positionsByStatus: new Gauge({
      name: `${prefix}positions_by_status`,
      help: 'Number of positions grouped by status',
      labelNames: ['status'],
      registers: [registry],
    }),
    slFiredTotal: new Counter({
      name: `${prefix}sl_fired_total`,
      help: 'Total number of stop-loss orders triggered',
      registers: [registry],
    }),
    tpFiredTotal: new Counter({
      name: `${prefix}tp_fired_total`,
      help: 'Total number of take-profit orders triggered',
      registers: [registry],
    }),
    trailingFiredTotal: new Counter({
      name: `${prefix}trailing_fired_total`,
      help: 'Total number of trailing stop orders triggered',
      registers: [registry],
    }),
    preCloseTotal: new Counter({
      name: `${prefix}pre_close_total`,
      help: 'Total number of pre-close exits triggered',
      labelNames: ['type'],
      registers: [registry],
    }),
    killSwitchTotal: new Counter({
      name: `${prefix}kill_switch_total`,
      help: 'Total number of kill-switch force closes',
      registers: [registry],
    }),
    spreadMean: new Gauge({
      name: `${prefix}spread_mean`,
      help: 'Mean relative spread (spreadTop / midPrice) across liquid evaluated positions in the last cycle',
      registers: [registry],
    }),
    clobFetchDuration: new Histogram({
      name: `${prefix}clob_fetch_duration_ms`,
      help: 'Duration of CLOB API fetches in milliseconds',
      buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
      registers: [registry],
    }),
    clobErrorsTotal: new Counter({
      name: `${prefix}clob_errors_total`,
      help: 'Total number of CLOB API errors',
      labelNames: ['endpoint'],
      registers: [registry],
    }),
    dataApiFetchDuration: new Histogram({
      name: `${prefix}data_api_fetch_duration_ms`,
      help: 'Duration of Data API fetches in milliseconds',
      buckets: [100, 500, 1000, 2000, 5000, 10000],
      registers: [registry],
    }),
    dataApiErrorsTotal: new Counter({
      name: `${prefix}data_api_errors_total`,
      help: 'Total number of Data API errors',
      registers: [registry],
    }),
    circuitBreakerOpen: new Gauge({
      name: `${prefix}circuit_breaker_open`,
      help: 'Whether the circuit breaker is currently open (1 = open, 0 = closed)',
      labelNames: ['name'],
      registers: [registry],
    }),
    wsReconnectTotal: new Counter({
      name: `${prefix}ws_reconnect_total`,
      help: 'Total number of WebSocket reconnections',
      labelNames: ['channel'],
      registers: [registry],
    }),
    strategyEvalDuration: new Histogram({
      name: `${prefix}strategy_eval_duration_ms`,
      help: 'Duration of strategy evaluation cycles in milliseconds',
      buckets: [5, 10, 25, 50, 100, 200, 500],
      registers: [registry],
    }),
    strategyEvalPositions: new Gauge({
      name: `${prefix}strategy_eval_positions`,
      help: 'Number of positions evaluated in the last strategy cycle',
      registers: [registry],
    }),
    illiquidPositions: new Gauge({
      name: `${prefix}illiquid_positions`,
      help: 'Number of positions with illiquid order books',
      registers: [registry],
    }),
    redemptionTotal: new Counter({
      name: `${prefix}redemption_total`,
      help: 'Total number of redemption attempts',
      labelNames: ['status', 'mode'],
      registers: [registry],
    }),
    redemptionPayoffTotal: new Counter({
      name: `${prefix}redemption_payoff_total`,
      help: 'Total number of redemption payoffs by outcome',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    snapshotCreatedTotal: new Counter({
      name: `${prefix}snapshot_created_total`,
      help: 'Trading snapshots created',
      labelNames: ['source', 'mode'],
      registers: [registry],
    }),
    snapshotCount: new Gauge({
      name: `${prefix}snapshot_count`,
      help: 'Total trading snapshots stored',
      labelNames: ['mode'],
      registers: [registry],
    }),
    snapshotPurgeTotal: new Counter({
      name: `${prefix}snapshot_purge_total`,
      help: 'Snapshots purged by retention',
      labelNames: ['mode'],
      registers: [registry],
    }),
    apiRouteDuration: new Histogram({
      name: `${prefix}api_route_duration_ms`,
      help: 'Duration of public API route handlers in milliseconds',
      labelNames: ['route'],
      buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
      registers: [registry],
    }),
    workerMetricsLastPushTimestamp: new Gauge({
      name: `${prefix}worker_metrics_last_push_timestamp`,
      help: 'Unix timestamp of the last metrics push from the worker',
      registers: [registry],
    }),
  };
}

/**
 * Module-level holder so record* helpers work regardless of where
 * createAppMetrics is called.
 */
let metricsHolder: AppMetrics | null = null;
let registryHolder: Registry | null = null;

export function setMetricsInstance(m: AppMetrics): void {
  metricsHolder = m;
}

export function setRegistry(r: Registry): void {
  registryHolder = r;
}

export function getRegistry(): Registry | null {
  return registryHolder;
}

export interface StrategyCycleSnapshot {
  durationMs: number;
  positionsEvaluated: number;
  positionsOpen: number;
  positionsOpenByMode: Record<string, number>;
  positionsByStatus: Record<string, number>;
  illiquidPositions: number;
  spreadMean: number;
}

function touchWorkerMetricsFreshness(): void {
  metricsHolder?.workerMetricsLastPushTimestamp?.set(Date.now() / 1000);
}

function setLabeledGauge(
  gauge: Gauge<string> | undefined,
  labels: Record<string, number>,
): void {
  if (!gauge) return;
  gauge.reset();
  for (const [k, v] of Object.entries(labels)) {
    gauge.labels(k).set(v);
  }
}

export function recordExitEvent(reason: string): void {
  if (!metricsHolder) return;
  switch (reason) {
    case 'SL':
      metricsHolder.slFiredTotal?.inc();
      break;
    case 'TP':
      metricsHolder.tpFiredTotal?.inc();
      break;
    case 'TRAILING':
      metricsHolder.trailingFiredTotal?.inc();
      break;
    case 'PRE_CLOSE_LOSS':
    case 'PRE_CLOSE_WIN':
      metricsHolder.preCloseTotal?.labels(reason).inc();
      break;
    case 'KILL_SWITCH':
      metricsHolder.killSwitchTotal?.inc();
      break;
  }
  touchWorkerMetricsFreshness();
}

export function recordStrategyCycle(snapshot: StrategyCycleSnapshot): void {
  if (!metricsHolder) return;
  metricsHolder.strategyEvalDuration?.observe(snapshot.durationMs);
  metricsHolder.strategyEvalPositions?.set(snapshot.positionsEvaluated);
  metricsHolder.positionsOpen?.set(snapshot.positionsOpen);
  metricsHolder.illiquidPositions?.set(snapshot.illiquidPositions);
  metricsHolder.spreadMean?.set(snapshot.spreadMean);
  setLabeledGauge(metricsHolder.positionsOpenByMode, snapshot.positionsOpenByMode);
  setLabeledGauge(metricsHolder.positionsByStatus, snapshot.positionsByStatus);
  touchWorkerMetricsFreshness();
}

export function recordRedemption(
  status: 'success' | 'failed',
  mode: 'sim' | 'real',
): void {
  metricsHolder?.redemptionTotal?.labels(status, mode).inc();
}

export function recordRedemptionPayoff(outcome: 'win' | 'loss'): void {
  metricsHolder?.redemptionPayoffTotal?.labels(outcome).inc();
}

export function recordCircuitBreakerState(
  name: string,
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
): void {
  const open = state === 'OPEN' ? 1 : 0;
  metricsHolder?.circuitBreakerOpen?.labels(name).set(open);
}

export function recordSnapshotCreated(
  source: string,
  mode: 'sim' | 'real' = 'sim',
): void {
  metricsHolder?.snapshotCreatedTotal?.labels(source, mode).inc();
}

export function recordSnapshotPurge(
  count: number,
  mode: 'sim' | 'real' = 'sim',
): void {
  metricsHolder?.snapshotPurgeTotal?.labels(mode).inc(count);
}

export function recordSnapshotCount(
  count: number,
  mode: 'sim' | 'real' = 'sim',
): void {
  metricsHolder?.snapshotCount?.labels(mode).set(count);
}

export function recordApiRouteDuration(route: string, durationMs: number): void {
  metricsHolder?.apiRouteDuration?.labels(route).observe(durationMs);
}
