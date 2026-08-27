import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import {
  CopiedPosition,
  Execution,
  MarketService,
  serializeWeatherForecast,
  WeatherPositionForecast,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

const PENDING_EXECUTION_STATUSES = ['placing', 'placed', 'live_on_clob', 'partial'] as const;

function parseDateQuery(value: unknown): Date | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== 'string') return undefined;
  const date = new Date(first);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function createWeatherAlgoExecutionsRouter(ds: DataSource): Router {
  const router = Router();

  router.get('/', requireJwt, async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50), 200));
    const offset = Math.max(0, Number(req.query.offset ?? 0));

    const qb = ds.getRepository(Execution).createQueryBuilder('e');

    // Only WEATHER_* executions
    qb.andWhere('e.reason LIKE :weatherPattern', { weatherPattern: 'WEATHER_%' });

    const conditionId = typeof req.query.conditionId === 'string' ? req.query.conditionId : null;
    if (conditionId) {
      qb.innerJoin('CopiedPosition', 'cp', 'cp.id = e.copied_position_id');
      qb.andWhere('cp.condition_id = :conditionId', { conditionId });
    }

    if (req.query.mode) {
      qb.andWhere('e.mode = :mode', { mode: req.query.mode });
    }

    const statusGroup = req.query.statusGroup;
    if (statusGroup === 'pending') {
      qb.andWhere('e.status IN (:...pendingStatuses)', {
        pendingStatuses: [...PENDING_EXECUTION_STATUSES],
      });
    } else if (req.query.status) {
      qb.andWhere('e.status = :status', { status: req.query.status });
    }

    const from = parseDateQuery(req.query.from);
    const to = parseDateQuery(req.query.to);
    if (from) {
      qb.andWhere('e.executedAt >= :from', { from });
    }
    if (to) {
      qb.andWhere('e.executedAt <= :to', { to });
    }

    qb.orderBy('e.executedAt', 'DESC').addOrderBy('e.id', 'DESC');
    qb.take(limit).skip(offset);

    const [executions, total] = await qb.getManyAndCount();

    const positionIds = [...new Set(executions.map((exec) => exec.copiedPositionId))];
    const positions =
      positionIds.length > 0
        ? await ds.getRepository(CopiedPosition).find({ where: { id: In(positionIds) } })
        : [];
    const positionById = new Map(positions.map((pos) => [pos.id, pos]));

    const conditionIds = [...new Set(positions.map((pos) => pos.conditionId))];
    const marketService = new MarketService(ds);
    const marketsByCondition =
      conditionIds.length > 0 ? await marketService.resolveMany(conditionIds) : new Map();

    const forecasts =
      positionIds.length > 0
        ? await ds.getRepository(WeatherPositionForecast).find({
            where: { copiedPositionId: In(positionIds) },
          })
        : [];
    const forecastByPositionId = new Map(
      forecasts.map((f) => [f.copiedPositionId, f] as const),
    );

    const items = executions.map((exec) => {
      const position = positionById.get(exec.copiedPositionId);
      const market = position ? marketsByCondition.get(position.conditionId) : undefined;
      const forecast = forecastByPositionId.get(exec.copiedPositionId);
      return {
        ...exec,
        marketQuestion: market?.question ?? null,
        marketUrl: market?.url ?? null,
        outcome: position?.outcome ?? null,
        conditionId: position?.conditionId ?? null,
        strategyId: position?.strategyId ?? null,
        weatherForecast: forecast ? serializeWeatherForecast(forecast) : null,
      };
    });

    res.json({ items, total });
  });

  return router;
}