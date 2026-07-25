import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordExitEvent,
  recordStrategyCycle,
  setMetricsInstance,
  type AppMetrics,
} from './metrics.js';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

function createMockMetrics(): AppMetrics {
  const registry = new Registry();
  return {
    positionsOpen: new Gauge({ name: 'test_positions_open', help: 'test', registers: [registry] }),
    positionsOpenByMode: new Gauge({ name: 'test_positions_open_by_mode', help: 'test', labelNames: ['mode'], registers: [registry] }),
    positionsByStatus: new Gauge({ name: 'test_positions_by_status', help: 'test', labelNames: ['status'], registers: [registry] }),
    slFiredTotal: new Counter({ name: 'test_sl_fired_total', help: 'test', registers: [registry] }),
    tpFiredTotal: new Counter({ name: 'test_tp_fired_total', help: 'test', registers: [registry] }),
    trailingFiredTotal: new Counter({ name: 'test_trailing_fired_total', help: 'test', registers: [registry] }),
    preCloseTotal: new Counter({ name: 'test_pre_close_total', help: 'test', labelNames: ['type'], registers: [registry] }),
    killSwitchTotal: new Counter({ name: 'test_kill_switch_total', help: 'test', registers: [registry] }),
    spreadMean: new Gauge({ name: 'test_spread_mean', help: 'test', registers: [registry] }),
    clobFetchDuration: new Histogram({ name: 'test_clob_fetch_duration_ms', help: 'test', buckets: [10, 50, 100], registers: [registry] }),
    clobErrorsTotal: new Counter({ name: 'test_clob_errors_total', help: 'test', labelNames: ['endpoint'], registers: [registry] }),
    dataApiFetchDuration: new Histogram({ name: 'test_data_api_fetch_duration_ms', help: 'test', buckets: [100, 500], registers: [registry] }),
    dataApiErrorsTotal: new Counter({ name: 'test_data_api_errors_total', help: 'test', registers: [registry] }),
    circuitBreakerOpen: new Gauge({ name: 'test_circuit_breaker_open', help: 'test', labelNames: ['name'], registers: [registry] }),
    wsReconnectTotal: new Counter({ name: 'test_ws_reconnect_total', help: 'test', labelNames: ['channel'], registers: [registry] }),
    strategyEvalDuration: new Histogram({ name: 'test_strategy_eval_duration_ms', help: 'test', buckets: [5, 10, 25], registers: [registry] }),
    strategyEvalPositions: new Gauge({ name: 'test_strategy_eval_positions', help: 'test', registers: [registry] }),
    illiquidPositions: new Gauge({ name: 'test_illiquid_positions', help: 'test', registers: [registry] }),
    redemptionTotal: new Counter({ name: 'test_redemption_total', help: 'test', labelNames: ['status', 'mode'], registers: [registry] }),
    redemptionPayoffTotal: new Counter({ name: 'test_redemption_payoff_total', help: 'test', labelNames: ['outcome'], registers: [registry] }),
    snapshotCreatedTotal: new Counter({ name: 'test_snapshot_created_total', help: 'test', labelNames: ['source'], registers: [registry] }),
    snapshotCount: new Gauge({ name: 'test_snapshot_count', help: 'test', registers: [registry] }),
    snapshotPurgeTotal: new Counter({ name: 'test_snapshot_purge_total', help: 'test', registers: [registry] }),
    apiRouteDuration: new Histogram({ name: 'test_api_route_duration_ms', help: 'test', labelNames: ['route'], buckets: [10, 50, 100], registers: [registry] }),
    workerMetricsLastPushTimestamp: new Gauge({ name: 'test_worker_metrics_last_push_timestamp', help: 'test', registers: [registry] }),
  };
}

function getMetricValue(metric) {
  return metric.get().then((d) => d.values[0]?.value ?? 0);
}

describe('recordExitEvent', () => {
  let metrics: AppMetrics;

  beforeEach(() => {
    metrics = createMockMetrics();
    setMetricsInstance(metrics);
  });

  it('increments slFiredTotal for SL', async () => {
    recordExitEvent('SL');
    await expect(getMetricValue(metrics.slFiredTotal)).resolves.toBe(1);
  });

  it('increments tpFiredTotal for TP', async () => {
    recordExitEvent('TP');
    await expect(getMetricValue(metrics.tpFiredTotal)).resolves.toBe(1);
  });

  it('increments trailingFiredTotal for TRAILING', async () => {
    recordExitEvent('TRAILING');
    await expect(getMetricValue(metrics.trailingFiredTotal)).resolves.toBe(1);
  });

  it('increments preCloseTotal with label for PRE_CLOSE_LOSS', async () => {
    recordExitEvent('PRE_CLOSE_LOSS');
    const data = await metrics.preCloseTotal.get();
    const match = data.values.find((v: { labels: Record<string, string> }) => v.labels.type === 'PRE_CLOSE_LOSS');
    expect(match?.value).toBe(1);
  });

  it('increments preCloseTotal with label for PRE_CLOSE_WIN', async () => {
    recordExitEvent('PRE_CLOSE_WIN');
    const data = await metrics.preCloseTotal.get();
    const match = data.values.find((v: { labels: Record<string, string> }) => v.labels.type === 'PRE_CLOSE_WIN');
    expect(match?.value).toBe(1);
  });

  it('increments killSwitchTotal for KILL_SWITCH', async () => {
    recordExitEvent('KILL_SWITCH');
    await expect(getMetricValue(metrics.killSwitchTotal)).resolves.toBe(1);
  });

  it('ignores unknown reasons silently', async () => {
    recordExitEvent('UNKNOWN_REASON');
    await expect(getMetricValue(metrics.slFiredTotal)).resolves.toBe(0);
    await expect(getMetricValue(metrics.tpFiredTotal)).resolves.toBe(0);
  });

  it('does nothing when metricsHolder is null', () => {
    setMetricsInstance(null as unknown as AppMetrics);
    expect(() => recordExitEvent('SL')).not.toThrow();
  });
});

describe('recordStrategyCycle', () => {
  let metrics: AppMetrics;

  beforeEach(() => {
    metrics = createMockMetrics();
    setMetricsInstance(metrics);
  });

  it('records all snapshot fields', async () => {
    recordStrategyCycle({
      durationMs: 42,
      positionsEvaluated: 10,
      positionsOpen: 5,
      positionsOpenByMode: { sim: 3, real: 2 },
      positionsByStatus: { open: 5, closing: 3, closed: 2 },
      illiquidPositions: 1,
      spreadMean: 0.05,
    });

    await expect(getMetricValue(metrics.strategyEvalPositions)).resolves.toBe(10);
    await expect(getMetricValue(metrics.positionsOpen)).resolves.toBe(5);
    await expect(getMetricValue(metrics.illiquidPositions)).resolves.toBe(1);
    await expect(getMetricValue(metrics.spreadMean)).resolves.toBe(0.05);
  });

  it('handles empty positions', async () => {
    recordStrategyCycle({
      durationMs: 0,
      positionsEvaluated: 0,
      positionsOpen: 0,
      positionsOpenByMode: {},
      positionsByStatus: {},
      illiquidPositions: 0,
      spreadMean: 0,
    });

    await expect(getMetricValue(metrics.strategyEvalPositions)).resolves.toBe(0);
    await expect(getMetricValue(metrics.positionsOpen)).resolves.toBe(0);
  });

  it('resets labeled gauges before setting', async () => {
    // Set a stale label first
    metrics.positionsOpenByMode.labels('sim').set(99);
    metrics.positionsByStatus.labels('old_status').set(99);

    recordStrategyCycle({
      durationMs: 10,
      positionsEvaluated: 1,
      positionsOpen: 1,
      positionsOpenByMode: { real: 1 },
      positionsByStatus: { open: 1 },
      illiquidPositions: 0,
      spreadMean: 0,
    });

    // Stale label should be gone (reset)
    const openByModeData = await metrics.positionsOpenByMode.get();
    const simVal = openByModeData.values.find((v: { labels: Record<string, string> }) => v.labels.mode === 'sim');
    const realVal = openByModeData.values.find((v: { labels: Record<string, string> }) => v.labels.mode === 'real');
    expect(simVal?.value ?? 0).toBe(0);
    expect(realVal?.value).toBe(1);

    const byStatusData = await metrics.positionsByStatus.get();
    const oldStatusVal = byStatusData.values.find((v: { labels: Record<string, string> }) => v.labels.status === 'old_status');
    const openVal = byStatusData.values.find((v: { labels: Record<string, string> }) => v.labels.status === 'open');
    expect(oldStatusVal?.value ?? 0).toBe(0);
    expect(openVal?.value).toBe(1);
  });
});
