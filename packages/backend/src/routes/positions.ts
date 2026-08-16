import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  buildCloseOrderSignal,
  CopiedPosition,
  CopiedPositionPresenter,
  CopiedPositionService,
  Execution,
  ExitAttemptEventService,
  EXIT_ATTEMPT_LIST_MAX_LIMIT,
  MarketPositionTickService,
  algoKindLikePattern,
} from '@polywatch/core';
import { requireJwt, type AuthRequest } from '../middleware/auth.js';
import { getRedis } from '../redis.js';
import { emitPositionUpdate } from '../websocket.js';
import { recordApiRouteDuration } from '../metrics.js';

async function resolveCloseReason(
  ds: DataSource,
  positionId: number,
): Promise<string | null> {
  const exec = await ds
    .getRepository(Execution)
    .createQueryBuilder('e')
    .where('e.copied_position_id = :id', { id: positionId })
    .andWhere('e.side = :side', { side: 'SELL' })
    .andWhere('e.status IN (:...statuses)', {
      statuses: ['filled', 'partial', 'no_payout'],
    })
    .orderBy('e.executed_at', 'DESC')
    .getOne();
  return exec?.reason ?? null;
}

export function createPositionsRouter(ds: DataSource): Router {
  const router = Router();
  const positionService = new CopiedPositionService(ds);
  const presenter = new CopiedPositionPresenter(ds);

  const parseDateParam = (value: unknown): Date | undefined | 'invalid' => {
    if (value === undefined || value === '') return undefined;
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : 'invalid';
  };

  async function timeRoute<T>(
    route: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      recordApiRouteDuration(route, performance.now() - start);
    }
  }

  router.get('/', requireJwt, async (req, res) => {
    await timeRoute('GET /api/copied-positions', async () => {
      const repo = ds.getRepository(CopiedPosition);
      const qb = repo.createQueryBuilder('p');
      if (req.query.status) {
        // Allow fetching several statuses via comma-separated values, e.g. open,closing,pending.
        const statuses = (req.query.status as string).split(',').filter(Boolean);
        if (statuses.length === 1) {
          qb.andWhere('p.status = :status', { status: statuses[0] });
        } else if (statuses.length > 1) {
          qb.andWhere('p.status IN (:...statuses)', { statuses });
        }
      }
      if (req.query.mode) {
        qb.andWhere('p.mode = :mode', { mode: req.query.mode });
      }
      if (req.query.algoKind) {
        const pattern = algoKindLikePattern(req.query.algoKind as 'crypto' | 'weather' | 'copy');
        qb.andWhere('p.reason LIKE :algoPattern', { algoPattern: pattern });
      }
      if (req.query.reason === 'algo') {
        qb.andWhere('p.reason LIKE :algoPattern', { algoPattern: 'ALGO_%' });
      } else if (req.query.reason === 'weather') {
        qb.andWhere('p.reason LIKE :weatherPattern', { weatherPattern: 'WEATHER_%' });
      } else if (req.query.reason) {
        qb.andWhere('p.reason = :reason', { reason: req.query.reason });
      }
      if (req.query.status === 'closed') {
        qb.orderBy('p.closed_at', 'DESC');
      }
      const isClosed = req.query.status === 'closed';

      if (isClosed) {
        const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 200));
        const offset = Math.max(0, Number(req.query.offset ?? 0));
        qb.take(limit).skip(offset);
      }

      const [positions, total] = await qb.getManyAndCount();

      if (isClosed) {
        const withCloseReason = await Promise.all(
          positions.map(async (pos) => {
            if (pos.closeReason) return pos;
            const closeReason = await resolveCloseReason(ds, pos.id);
            return { ...pos, closeReason };
          }),
        );
        res.json({ items: await presenter.enrich(withCloseReason), total });
        return;
      }

      res.json(await presenter.enrich(positions));
    });
  });

  router.get('/:id/ticks', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    await timeRoute('GET /api/positions/:id/ticks', async () => {
      const limit = Math.min(Number(req.query.limit ?? '1000'), 10000);
      const offset = Math.max(Number(req.query.offset ?? '0'), 0);
      if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
        res.status(400).json({ error: 'invalid_pagination' });
        return;
      }
      const from = parseDateParam(req.query.from);
      const to = parseDateParam(req.query.to);
      if (from === 'invalid' || to === 'invalid') {
        res.status(400).json({ error: 'invalid_date' });
        return;
      }

      const result = await new MarketPositionTickService(ds).listByPosition(id, {
        limit,
        offset,
        from,
        to,
      });
      res.json(result);
    });
  });

  router.get('/:id/exit-attempts', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    await timeRoute('GET /api/copied-positions/:id/exit-attempts', async () => {
      const rawLimit = Number(req.query.limit ?? '500');
      const rawOffset = Number(req.query.offset ?? '0');
      if (!Number.isFinite(rawLimit) || !Number.isFinite(rawOffset)) {
        res.status(400).json({ error: 'invalid_pagination' });
        return;
      }
      const limit = Math.min(Math.max(rawLimit, 1), EXIT_ATTEMPT_LIST_MAX_LIMIT);
      const offset = Math.max(rawOffset, 0);

      const result = await new ExitAttemptEventService(ds).listByPosition(id, {
        limit,
        offset,
      });
      res.json(result);
    });
  });

  router.post('/:id/close', requireJwt, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const pos = await ds.getRepository(CopiedPosition).findOne({
      where: { id },
    });
    if (!pos || !['open', 'failed'].includes(pos.status)) {
      res.status(409).json({ error: 'invalid_status' });
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
      bidVwap: pos.executableBidVwap ?? pos.entryPrice,
      closingAttemptSeq: closeResult.closingAttemptSeq,
    });

    try {
      await getRedis().rpush('close-signals', JSON.stringify(signal));
    } catch (err) {
      await positionService.markFailed(id);
      res.status(502).json({ error: 'enqueue_failed' });
      return;
    }

    emitPositionUpdate({ id, status: 'closing' });
    res.json({ ok: true, orderSignalId: signal.id });
  });

  return router;
}
