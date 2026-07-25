import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  CopiedPosition,
  Market,
  MarketPriceTickService,
  MarketPriceHistorySyncService,
  MarketPriceHistoryBackfillService,
  fetchPriceHistory,
  fetchBookMinOrderSize,
  getClobApiUrl,
  effectiveEntryMos,
  MIN_ORDER_SHARES,
  parseMarketOutcomes,
  toOutcomeSideLabels,
  type MinOrderSharesSource,
  type OutcomeSideLabels,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { CONDITION_ID_PATTERN } from '../lib/condition-id.js';
import { computeTimeframeFrom, TIMEFRAMES } from '../lib/timeframe.js';
import { toTimestampMs } from '../lib/timestamp.js';

const conditionIdSchema = z.string().regex(CONDITION_ID_PATTERN);
const timeframeSchema = z
  .string()
  .refine((v) => (TIMEFRAMES as readonly string[]).includes(v), {
    message: `timeframe must be one of: ${TIMEFRAMES.join(', ')}`,
  })
  .optional();

const assetIdQuerySchema = z.string().min(1);

export interface MarketOrderSizeResponse {
  assetId: string;
  minOrderShares: number;
  source: MinOrderSharesSource;
  /** Entry gate floor when source is fallback (conservative). */
  effectiveEntryMos: number;
}

export interface MarketChartPointMetrics {
  openPositionsCount: number;
  openExposureUsd: number | null;
  unrealizedPnl: number | null;
}

export interface MarketChartPoint {
  t: number;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  lastTradePrice: number | null;
  metrics?: MarketChartPointMetrics | null;
}

export interface MarketChartResponse {
  conditionId: string;
  points: MarketChartPoint[];
  outcomeLabels: OutcomeSideLabels | null;
}

async function loadOutcomeLabels(
  ds: DataSource,
  conditionId: string,
): Promise<OutcomeSideLabels | null> {
  const market = await ds.getRepository(Market).findOne({ where: { conditionId } });
  if (!market) return null;
  return toOutcomeSideLabels(parseMarketOutcomes(market.outcomes));
}

async function loadMarketMetrics(
  ds: DataSource,
  conditionId: string,
): Promise<MarketChartPointMetrics> {
  const positions = await ds
    .getRepository(CopiedPosition)
    .createQueryBuilder('p')
    .where('p.condition_id = :conditionId', { conditionId })
    .andWhere("p.status = 'open'")
    .getMany();

  let count = 0;
  let exposureUsd = 0;
  let unrealizedPnl = 0;

  for (const pos of positions) {
    count += 1;
    exposureUsd += pos.entryPrice * pos.quantity;
    unrealizedPnl += pos.unrealizedPnl ?? 0;
  }

  return {
    openPositionsCount: count,
    openExposureUsd: count > 0 ? exposureUsd : null,
    unrealizedPnl: count > 0 ? unrealizedPnl : null,
  };
}

function ticksToPoints(
  ticks: Awaited<ReturnType<MarketPriceTickService['listTicks']>>,
  metrics: MarketChartPointMetrics | null,
): MarketChartPoint[] {
  return ticks.map((t) => ({
    t: toTimestampMs(t.recordedAt),
    bestBid: t.bestBid,
    bestAsk: t.bestAsk,
    midPrice: t.midPrice,
    spread: t.spread,
    spreadPercent: t.spreadPercent,
    lastTradePrice: t.lastTradePrice,
    metrics,
  }));
}

export function createMarketChartRouter(ds: DataSource): Router {
  const router = Router();
  const tickService = new MarketPriceTickService(ds);
  const syncService = new MarketPriceHistorySyncService(ds);
  const backfillService = new MarketPriceHistoryBackfillService(
    ds,
    tickService,
    syncService,
  );

  router.get('/order-size', requireJwt, async (req, res) => {
    const parsedAsset = assetIdQuerySchema.safeParse(req.query.assetId);
    if (!parsedAsset.success) {
      res.status(400).json({ error: 'invalid_asset_id' });
      return;
    }

    const assetId = parsedAsset.data;
    let minOrderShares = MIN_ORDER_SHARES;
    let source: MinOrderSharesSource = 'fallback';

    try {
      const fromBook = await fetchBookMinOrderSize(getClobApiUrl(), assetId);
      if (fromBook != null && fromBook > 0) {
        minOrderShares = fromBook;
        source = 'book';
      }
    } catch {
      // keep fallback — same as worker when book is gone
    }

    res.json({
      assetId,
      minOrderShares,
      source,
      effectiveEntryMos: effectiveEntryMos({ minShares: minOrderShares, source }),
    } satisfies MarketOrderSizeResponse);
  });

  router.get('/:conditionId', requireJwt, async (req, res) => {
    const parsedId = conditionIdSchema.safeParse(req.params.conditionId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'invalid_condition_id' });
      return;
    }

    const assetId =
      typeof req.query.assetId === 'string' && req.query.assetId.length > 0
        ? req.query.assetId
        : undefined;

    const parsedTf = timeframeSchema.safeParse(req.query.timeframe);
    if (!parsedTf.success) {
      res.status(400).json({ error: 'invalid_timeframe' });
      return;
    }

    const timeframe = parsedTf.data;
    let points: MarketChartPoint[] = [];

    // Pour les timeframes non-max avec un assetId, on appelle directement l'API Polymarket
    // qui retourne des données pré-agrégées à la résolution demandée (1h, 6h, 1j, etc.)
    if (assetId && timeframe && timeframe !== 'max') {
      const history = await fetchPriceHistory({
        assetId,
        interval: timeframe as '1h' | '6h' | '1d' | '1w' | '1m' | 'max',
      });

      if (history.length > 0) {
        points = history.map((pt) => ({
          t: pt.t * 1000, // API retourne en secondes, on veut ms
          bestBid: null,
          bestAsk: null,
          midPrice: pt.p,
          spread: null,
          spreadPercent: null,
          lastTradePrice: null,
          metrics: null,
        }));
      }
    }

    // Fallback : si l'API Polymarket n'a rien retourné (ou pas d'assetId, ou timeframe=max),
    // on utilise les ticks stockés localement
    if (points.length === 0) {
      const from = timeframe ? (computeTimeframeFrom(timeframe) ?? undefined) : undefined;
      let ticks = await tickService.listTicks(parsedId.data, { assetId, from });

      if (ticks.length === 0 && assetId) {
        await backfillService.ensureHistorySynced(parsedId.data, assetId);
        ticks = await tickService.listTicks(parsedId.data, { assetId });
      }

      if (ticks.length > 0) {
        const metrics = await loadMarketMetrics(ds, parsedId.data);
        points = ticksToPoints(ticks, metrics);
      }
    }

    const outcomeLabels = await loadOutcomeLabels(ds, parsedId.data);

    res.json({
      conditionId: parsedId.data,
      points,
      outcomeLabels,
    } satisfies MarketChartResponse);
  });

  return router;
}
