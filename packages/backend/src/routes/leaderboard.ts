import { LEADERBOARD_API_CATEGORIES } from '@polywatch/core';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireJwt } from '../middleware/auth.js';

const querySchema = z.object({
  category: z.enum(LEADERBOARD_API_CATEGORIES).default('OVERALL'),
  timePeriod: z.enum(['DAY', 'WEEK', 'MONTH', 'ALL']).default('ALL'),
  orderBy: z.enum(['PNL', 'VOL']).default('PNL'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

export function createLeaderboardRouter(): Router {
  const router = Router();

  router.get('/', requireJwt, async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }

    const { category, timePeriod, orderBy, limit, offset } = parsed.data;
    const params = new URLSearchParams({
      category,
      timePeriod,
      orderBy,
      limit: String(limit),
      offset: String(offset),
    });

    const url = `${config.dataApi}/v1/leaderboard?${params}`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      res.status(502).json({ error: 'polymarket_api_error' });
      return;
    }

    const entries = (await apiRes.json()) as LeaderboardEntry[];
    res.json(entries);
  });

  return router;
}
