import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  MoveEventEntity,
  PollCycleService,
  MoveEventService,
  WatchlistService,
} from '@polywatch/core';
import {
  emitAlert,
  emitPnlTicks,
  emitMarketTicks,
  emitMoveDetected,
  emitMarketPercentUpdates,
  emitAlgoChartTick,
} from '../../websocket.js';
import type { PnlTick, MarketTick, MarketPercentUpdate, AlgoChartTickUpdate } from '@polywatch/core';
import { recordCircuitBreakerState } from '../../metrics.js';

export function createInternalWatchlistRouter(ds: DataSource): Router {
  const router = Router();
  const pollService = new PollCycleService(ds);
  const moveEventService = new MoveEventService(ds);
  const watchlistService = new WatchlistService(ds);

  router.get('/watchlist', async (_req, res) => {
    res.json(await watchlistService.loadAll());
  });

  router.post('/alerts', (req, res) => {
    const { type, message } = req.body ?? {};
    if (typeof type !== 'string' || typeof message !== 'string') {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    emitAlert({ type, message, at: new Date().toISOString() });
    res.json({ ok: true });
  });

  router.post('/metrics/circuit-breaker', (req, res) => {
    const { name, state } = req.body ?? {};
    if (
      typeof name !== 'string' ||
      !name ||
      (state !== 'CLOSED' && state !== 'OPEN' && state !== 'HALF_OPEN')
    ) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    recordCircuitBreakerState(name, state);
    res.json({ ok: true });
  });

  router.get('/move-events', async (req, res) => {
    if (req.query.processed === 'false') {
      res.json(await moveEventService.loadUnprocessed());
      return;
    }
    res.json(await ds.getRepository(MoveEventEntity).find());
  });

  router.post('/reconcile/:address', async (req, res) => {
    const moves = await pollService.reconcile(
      req.params.address,
      req.body.snapshot ?? [],
    );
    res.json(moves);
  });

  router.post('/poll-cycle/:address', async (req, res) => {
    const moves = await pollService.runPollCycle(
      req.params.address,
      req.body.snapshot ?? [],
    );
    res.json(moves);
  });

  router.patch('/move-events/processed', async (req, res) => {
    await moveEventService.markProcessed(req.body.ids ?? []);
    res.json({ ok: true });
  });

  router.post('/pnl-ticks', async (req, res) => {
    const ticks = (req.body.ticks ?? []) as PnlTick[];
    emitPnlTicks(ticks);
    res.json({ ok: true });
  });

  router.post('/market-ticks', async (req, res) => {
    const ticks = (req.body.ticks ?? []) as MarketTick[];
    emitMarketTicks(ticks);
    res.json({ ok: true });
  });

  router.post('/market-pct-updates', async (req, res) => {
    const updates = (req.body.updates ?? []) as MarketPercentUpdate[];
    if (updates.length > 0) {
      console.log(
        `[market-pct-updates] received ${updates.length} update(s) for ${updates
          .map((u) => u.conditionId)
          .join(', ')}`,
      );
    }
    emitMarketPercentUpdates(updates);
    res.json({ ok: true });
  });

  router.post('/algo-chart-ticks', async (req, res) => {
    const tick = req.body.tick as AlgoChartTickUpdate | undefined;
    if (
      !tick ||
      typeof tick.conditionId !== 'string' ||
      typeof tick.t !== 'number'
    ) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    emitAlgoChartTick(tick);
    res.json({ ok: true });
  });

  router.post('/move-detected', async (_req, res) => {
    emitMoveDetected({});
    res.json({ ok: true });
  });

  return router;
}
