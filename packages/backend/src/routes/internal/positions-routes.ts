import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import {
  buildCloseOrderSignal,
  CopiedPosition,
  Execution,
  ReservationService,
  ExecutionService,
  CopiedPositionService,
  SimulationService,
} from '@polywatch/core';
import { getRedis } from '../../redis.js';
import { fetchPusdBalance } from '../../polymarket/pusd-balance.js';
import { resolveTradingWalletContext } from '../../polymarket/trading-wallet-resolver.js';
import pino from 'pino';

const log = pino({ name: 'internal-positions' });

export function createInternalPositionsRouter(ds: DataSource): Router {
  const router = Router();
  const reservationService = new ReservationService(ds);
  const executionService = new ExecutionService(ds);
  const positionService = new CopiedPositionService(ds);
  const simulationService = new SimulationService(ds);

  router.get('/copied-positions', async (req, res) => {
    const statuses = (req.query.status as string)?.split(',') ?? [
      'pending',
      'open',
      'closing',
    ];
    const positions = await ds
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.status IN (:...statuses)', { statuses })
      .getMany();
    res.json(positions);
  });

  router.get('/balances', async (req, res) => {
    const mode = req.query.mode ?? 'sim';
    if (mode === 'sim') {
      const parsed = z.enum(['crypto', 'weather', 'copy']).safeParse(req.query.algoKind ?? 'crypto');
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_query' });
        return;
      }
      res.json(await simulationService.getSnapshot(parsed.data));
      return;
    }

    const ctx = await resolveTradingWalletContext(ds);
    if (!ctx?.depositAddress) {
      res.json({ amount: 0, note: ctx ? 'no_deposit_address' : 'no_credentials' });
      return;
    }

    try {
      const amount = await fetchPusdBalance(ctx.depositAddress);
      res.json({ amount, note: 'on_chain_pusd_balance' });
    } catch (err) {
      log.warn({ err, depositAddress: ctx.depositAddress }, 'pusd balance fetch failed');
      res.status(502).json({ amount: 0, error: 'pusd_balance_fetch_failed' });
    }
  });

  router.post('/position-reservations', async (req, res) => {
    try {
      const result = await reservationService.reserve(req.body);
      res.json(result);
    } catch (e) {
      res.status(409).json({ reason: (e as Error).message });
    }
  });

  router.delete('/position-reservations/:orderSignalId', async (req, res) => {
    await reservationService.release(req.params.orderSignalId);
    res.status(204).end();
  });

  router.patch('/copied-positions/:id/pending-resolution', async (req, res) => {
    const pos = await positionService.markPendingResolution(
      Number(req.params.id),
      req.body.winningTokenId,
      req.body.conditionId ?? '',
    );
    if (!pos) {
      res.status(409).json({ error: 'transition_failed' });
      return;
    }
    res.json({ copiedPositionId: pos.id, status: pos.status });
  });

  router.post('/executions/claim', async (req, res) => {
    try {
      const result = await executionService.claim(req.body);
      res.json(result.execution);
    } catch (e) {
      if ((e as Error).message === 'already_claimed') {
        res.status(409).json({ error: 'already_claimed' });
        return;
      }
      throw e;
    }
  });

  router.post('/copied-positions/:id/retry-close', async (req, res) => {
    const id = Number(req.params.id);
    const pos = await ds.getRepository(CopiedPosition).findOne({
      where: { id },
    });
    if (!pos) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    if (pos.status === 'closing') {
      await positionService.markFailed(id);
      const refreshed = await ds.getRepository(CopiedPosition).findOne({
        where: { id },
      });
      if (!refreshed || refreshed.status !== 'failed') {
        res.status(409).json({ error: 'retry_reset_failed' });
        return;
      }
      Object.assign(pos, refreshed);
    }

    if (!['open', 'failed'].includes(pos.status)) {
      res.status(409).json({ error: 'invalid_status', status: pos.status });
      return;
    }

    const closeResult = await positionService.beginClose(id, 'MANUAL');
    if (!closeResult.success) {
      res.status(409).json({ error: 'close_failed' });
      return;
    }

    const signal = buildCloseOrderSignal({
      pos,
      reason: 'MANUAL',
      bidVwap: pos.entryBidVwap ?? pos.entryPrice,
      closingAttemptSeq: closeResult.closingAttemptSeq,
    });

    try {
      await getRedis().rpush('close-signals', JSON.stringify(signal));
    } catch (err) {
      req.log?.error({ err, positionId: id }, 'close-signal enqueue failed');
      await positionService.markFailed(id);
      res.status(502).json({ error: 'enqueue_failed' });
      return;
    }
    res.json({ ok: true, orderSignalId: signal.id, message: 'retry_close_enqueued' });
  });

  router.get('/executions', async (_req, res) => {
    res.json(
      await ds.getRepository(Execution).find({
        order: { id: 'DESC' },
        take: 50,
      }),
    );
  });

  return router;
}
