import { Router } from 'express';
import { z } from 'zod';
import {
  buildNavMarketTags,
  createTtlCache,
  fetchGammaTags,
  filterCryptoGammaTags,
  filterGammaTags,
  type GammaTag,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { resolveBackendConfig } from '../system-config-resolver.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const loadAllTags = createTtlCache<GammaTag[]>(CACHE_TTL_MS);

export async function resolveMarketTagsCacheTtlMs(): Promise<number> {
  return resolveBackendConfig('backend.cache.market_tags.ttl_ms', CACHE_TTL_MS);
}

const querySchema = z.object({
  search: z.string().max(100).optional(),
});

export function createMarketTagsRouter(): Router {
  const router = Router();

  router.get('/', requireJwt, async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }

    try {
      const nav = buildNavMarketTags();
      const allTags = await loadAllTags(() => fetchGammaTags());
      const cryptoTags = filterCryptoGammaTags(allTags);

      const search = parsed.data.search?.trim();
      let tags = search ? filterGammaTags(allTags, search) : [];

      if (search && tags.length > 50) {
        tags = tags.slice(0, 50);
      }

      res.json({ nav, tags, cryptoTags });
    } catch {
      res.status(502).json({ error: 'gamma_tags_error' });
    }
  });

  return router;
}
