import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { fetchGammaMarket, MarketService } from '@polywatch/core';
import { createBoundedImageCache } from '../lib/bounded-image-cache.js';
import { isValidConditionId } from '../lib/condition-id.js';

const CACHE_TTL_MS = 86_400_000;
const CACHE_MAX_ENTRIES = 200;
const iconCache = createBoundedImageCache(CACHE_MAX_ENTRIES, CACHE_TTL_MS);

export function createMarketIconsRouter(ds: DataSource): Router {
  const router = Router();
  const marketService = new MarketService(ds);

  router.get('/:conditionId', async (req, res) => {
    const conditionId = req.params.conditionId;
    if (!isValidConditionId(conditionId)) {
      res.status(400).end();
      return;
    }

    const cached = iconCache.get(conditionId);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.body);
      return;
    }

    const stored = await marketService.loadByConditionIds([conditionId]);
    let iconUrl = stored.get(conditionId)?.icon ?? null;

    if (!iconUrl) {
      const gamma = await fetchGammaMarket(conditionId);
      iconUrl = gamma?.icon ?? null;
      if (gamma?.icon) {
        await marketService.fetchAndPersist(conditionId);
      }
    }

    if (!iconUrl) {
      res.status(404).end();
      return;
    }

    try {
      const upstream = await fetch(iconUrl, {
        headers: { Accept: 'image/*' },
      });
      if (!upstream.ok) {
        res.status(502).end();
        return;
      }

      const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
      const body = Buffer.from(await upstream.arrayBuffer());
      iconCache.set(conditionId, body, contentType);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(body);
    } catch {
      res.status(502).end();
    }
  });

  return router;
}
