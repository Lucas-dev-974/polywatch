import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { CopiedPosition, Execution, algoKindLikePattern } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { requireServiceToken } from '../middleware/auth.js';
import { broadcastSimSnapshot } from '../notify/simulation.js';
import { emitExecution, emitPositionUpdate } from '../websocket.js';

function parseDateQuery(value: unknown): Date | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'string') return undefined;
  const date = new Date(first);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function createExecutionsRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/', requireJwt, async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 100));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const requireExecutedAt =
      req.query.hasExecutedAt === 'true' || req.query.hasExecutedAt === '1';

    const qb = ds.getRepository(Execution).createQueryBuilder('e');

    if (req.query.mode) {
      qb.andWhere('e.mode = :mode', { mode: req.query.mode });
    }
    if (req.query.algoKind) {
      const pattern = algoKindLikePattern(req.query.algoKind as 'crypto' | 'weather' | 'copy');
      qb.andWhere('e.reason LIKE :algoPattern', { algoPattern: pattern });
    }
    if (req.query.status) {
      qb.andWhere('e.status = :status', { status: req.query.status });
    }

    const from = parseDateQuery(req.query.from);
    const to = parseDateQuery(req.query.to);
    if (requireExecutedAt) {
      qb.andWhere('e.executedAt IS NOT NULL');
    }
    if (from) {
      qb.andWhere('e.executedAt >= :from', { from });
    }
    if (to) {
      qb.andWhere('e.executedAt <= :to', { to });
    }

    const sortBy = req.query.sortBy === 'id' ? 'id' : 'executedAt';
    if (sortBy === 'id') {
      qb.orderBy('e.id', 'DESC');
    } else {
      qb.orderBy('e.executedAt', 'DESC').addOrderBy('e.id', 'DESC');
    }

    qb.take(limit).skip(offset);

    const [executions, total] = await qb.getManyAndCount();
    res.json({ items: executions, total });
  });

  router.post('/', requireServiceToken, async (req, res) => {
    emitExecution(req.body);

    const exec = await ds.getRepository(Execution).findOne({
      where: { orderSignalId: req.body.orderSignalId },
    });
    if (exec) {
      const pos = await ds.getRepository(CopiedPosition).findOne({
        where: { id: exec.copiedPositionId },
      });
      if (pos) emitPositionUpdate(pos);
      if (exec.mode === 'sim') await broadcastSimSnapshot(ds);
    }

    res.json({ ok: true });
  });

  return router;
}