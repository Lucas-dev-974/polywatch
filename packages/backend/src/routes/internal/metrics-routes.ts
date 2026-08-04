import { Router } from 'express';
import {
  recordExitEvent,
  recordStrategyCycle,
  recordWeatherQuestionParse,
  getRegistry,
  type StrategyCycleSnapshot,
} from '../../metrics.js';

export function createInternalMetricsRouter(): Router {
  const router = Router();

  router.post('/exit-event', (req, res) => {
    const { reason } = req.body as { reason?: string };
    if (!reason || typeof reason !== 'string') {
      res.status(400).json({ error: 'missing or invalid reason' });
      return;
    }
    recordExitEvent(reason);
    res.json({ ok: true });
  });

  router.post('/strategy-cycle', (req, res) => {
    const body = req.body as Partial<StrategyCycleSnapshot>;
    if (typeof body.durationMs !== 'number') {
      res.status(400).json({ error: 'missing or invalid durationMs' });
      return;
    }
    recordStrategyCycle({
      durationMs: body.durationMs,
      positionsEvaluated: body.positionsEvaluated ?? 0,
      positionsOpen: body.positionsOpen ?? 0,
      positionsOpenByMode: body.positionsOpenByMode ?? {},
      positionsByStatus: body.positionsByStatus ?? {},
      illiquidPositions: body.illiquidPositions ?? 0,
      spreadMean: body.spreadMean ?? 0,
    });
    res.json({ ok: true });
  });

  router.post('/weather-question-parse', (req, res) => {
    const { parsed, unparsed } = req.body as { parsed?: number; unparsed?: number };
    const p = typeof parsed === 'number' && parsed > 0 ? parsed : 0;
    const u = typeof unparsed === 'number' && unparsed > 0 ? unparsed : 0;
    for (let i = 0; i < p; i++) recordWeatherQuestionParse(true);
    for (let i = 0; i < u; i++) recordWeatherQuestionParse(false);
    res.json({ ok: true });
  });

  router.get('/dashboard', async (_req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.json({ error: 'registry not initialized' });
      return;
    }
    const raw = await registry.getMetricsAsJSON();
    res.json(buildDashboardResponse(raw));
  });

  return router;
}

interface DashboardResponse {
  positions: {
    open: number;
    openByMode: Record<string, number>;
    byStatus: Record<string, number>;
    illiquid: number;
  };
  exits: {
    sl: number;
    tp: number;
    trailing: number;
    preClose: Record<string, number>;
    killSwitch: number;
  };
  strategy: {
    evalDurationMs: { count: number; sum: number; buckets: Record<string, number> };
    evalPositions: number;
    spreadMean: number;
  };
  worker: {
    lastPushTimestamp: number;
  };
  circuitBreaker: Record<string, number>;
  clob: {
    fetchDurationMs: { count: number; sum: number };
    errors: Record<string, number>;
  };
  dataApi: {
    fetchDurationMs: { count: number; sum: number };
    errors: number;
  };
  ws: {
    reconnects: Record<string, number>;
  };
  redemption: {
    total: Record<string, number>;
    payoff: Record<string, number>;
  };
  snapshots: {
    created: Record<string, number>;
    count: number;
    purged: number;
  };
  api: {
    routeDurationMs: Record<string, { count: number; sum: number }>;
  };
  nodejs: Record<string, number>;
}

function buildDashboardResponse(raw: unknown[]): DashboardResponse {
  const empty: DashboardResponse = {
    positions: { open: 0, openByMode: {}, byStatus: {}, illiquid: 0 },
    exits: { sl: 0, tp: 0, trailing: 0, preClose: {}, killSwitch: 0 },
    strategy: { evalDurationMs: { count: 0, sum: 0, buckets: {} }, evalPositions: 0, spreadMean: 0 },
    worker: { lastPushTimestamp: 0 },
    circuitBreaker: {},
    clob: { fetchDurationMs: { count: 0, sum: 0 }, errors: {} },
    dataApi: { fetchDurationMs: { count: 0, sum: 0 }, errors: 0 },
    ws: { reconnects: {} },
    redemption: { total: {}, payoff: {} },
    snapshots: { created: {}, count: 0, purged: 0 },
    api: { routeDurationMs: {} },
    nodejs: {},
  };

  for (const metric of raw) {
    const m = metric as {
      name: string;
      help: string;
      type: string;
      values: { labels: Record<string, string>; value: number; metricName?: string }[];
      buckets?: { le: string; value: number }[];
      count?: number;
      sum?: number;
    };

    switch (m.name) {
      case 'polywatch_positions_open':
        empty.positions.open = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_positions_open_by_mode':
        for (const v of m.values) {
          empty.positions.openByMode[v.labels.mode] = v.value;
        }
        break;
      case 'polywatch_positions_by_status':
        for (const v of m.values) {
          empty.positions.byStatus[v.labels.status] = v.value;
        }
        break;
      case 'polywatch_illiquid_positions':
        empty.positions.illiquid = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_sl_fired_total':
        empty.exits.sl = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_tp_fired_total':
        empty.exits.tp = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_trailing_fired_total':
        empty.exits.trailing = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_pre_close_total':
        for (const v of m.values) {
          empty.exits.preClose[v.labels.type] = v.value;
        }
        break;
      case 'polywatch_kill_switch_total':
        empty.exits.killSwitch = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_spread_mean':
        empty.strategy.spreadMean = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_strategy_eval_duration_ms': {
        empty.strategy.evalDurationMs.count = m.count ?? 0;
        empty.strategy.evalDurationMs.sum = m.sum ?? 0;
        if (m.buckets) {
          for (const b of m.buckets) {
            empty.strategy.evalDurationMs.buckets[b.le] = b.value;
          }
        }
        break;
      }
      case 'polywatch_strategy_eval_positions':
        empty.strategy.evalPositions = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_worker_metrics_last_push_timestamp':
        empty.worker.lastPushTimestamp = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_circuit_breaker_open':
        for (const v of m.values) {
          empty.circuitBreaker[v.labels.name] = v.value;
        }
        break;
      case 'polywatch_clob_fetch_duration_ms':
        empty.clob.fetchDurationMs.count = m.count ?? 0;
        empty.clob.fetchDurationMs.sum = m.sum ?? 0;
        break;
      case 'polywatch_clob_errors_total':
        for (const v of m.values) {
          empty.clob.errors[v.labels.endpoint] = v.value;
        }
        break;
      case 'polywatch_data_api_fetch_duration_ms':
        empty.dataApi.fetchDurationMs.count = m.count ?? 0;
        empty.dataApi.fetchDurationMs.sum = m.sum ?? 0;
        break;
      case 'polywatch_data_api_errors_total':
        empty.dataApi.errors = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_ws_reconnect_total':
        for (const v of m.values) {
          empty.ws.reconnects[v.labels.channel] = v.value;
        }
        break;
      case 'polywatch_redemption_total':
        for (const v of m.values) {
          const key = `${v.labels.status}_${v.labels.mode}`;
          empty.redemption.total[key] = v.value;
        }
        break;
      case 'polywatch_redemption_payoff_total':
        for (const v of m.values) {
          empty.redemption.payoff[v.labels.outcome] = v.value;
        }
        break;
      case 'polywatch_snapshot_created_total':
        for (const v of m.values) {
          empty.snapshots.created[v.labels.source] = v.value;
        }
        break;
      case 'polywatch_snapshot_count':
        empty.snapshots.count = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_snapshot_purge_total':
        empty.snapshots.purged = m.values[0]?.value ?? 0;
        break;
      case 'polywatch_api_route_duration_ms':
        for (const v of m.values) {
          const route = v.labels.route;
          if (!empty.api.routeDurationMs[route]) {
            empty.api.routeDurationMs[route] = { count: 0, sum: 0 };
          }
          empty.api.routeDurationMs[route].count = m.count ?? 0;
          empty.api.routeDurationMs[route].sum = m.sum ?? 0;
        }
        break;
      default:
        // Collect nodejs default metrics
        if (m.name.startsWith('nodejs_') || m.name.startsWith('process_')) {
          empty.nodejs[m.name] = m.values[0]?.value ?? 0;
        }
        break;
    }
  }

  return empty;
}
