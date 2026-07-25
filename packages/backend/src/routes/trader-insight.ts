import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  Market,
  WatchlistEntry,
  CopiedPosition,
  CopiedPositionPresenter,
  buildTraderAnalytics,
  parseAllowedMarketTags,
  fetchGammaMarket,
  buildActivitySummary,
  buildActivityTimeline,
  buildMarketBreakdown,
  buildRecentActivity,
  buildTraderCapitalSeries,
  filterTradeActivities,
  type TraderInsightActivityInput,
  type TraderInsightMarketMeta,
  type TraderInsightResponse,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import pino from 'pino';
import {
  fetchAllUserActivity,
  fetchGammaPublicProfile,
  fetchUserPortfolioValue,
  fetchUserPositions,
} from '../polymarket/trader-insight-fetcher.js';
import { fetchTraderFundingAnalysis, invalidateTraderFundingCacheForAddress } from '../polymarket/trader-funding-fetcher.js';

const log = pino({ name: 'trader-insight' });

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'invalid_address');

const querySchema = z.object({
  leaderboardRank: z.string().optional(),
  leaderboardPnl: z.coerce.number().optional(),
  leaderboardVol: z.coerce.number().optional(),
  userName: z.string().optional(),
  profileImage: z.string().optional(),
  xUsername: z.string().optional(),
  verifiedBadge: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  refreshFunding: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: TraderInsightResponse; expiresAt: number }>();

const GAMMA_MARKET_LOOKUP_LIMIT = 50;

async function loadMarketMeta(
  ds: DataSource,
  conditionIds: string[],
): Promise<Map<string, TraderInsightMarketMeta>> {
  const unique = [...new Set(conditionIds.map((id) => id.toLowerCase()))];
  const meta = new Map<string, TraderInsightMarketMeta>();
  if (unique.length === 0) return meta;

  const stored = await ds
    .getRepository(Market)
    .createQueryBuilder('m')
    .where('LOWER(m.condition_id) IN (:...ids)', { ids: unique })
    .getMany();

  for (const market of stored) {
    meta.set(market.conditionId.toLowerCase(), {
      conditionId: market.conditionId,
      tagSlugs: parseAllowedMarketTags(market.tagSlugs),
      category: market.category,
      question: market.question,
    });
  }

  const missing = unique.filter((id) => !meta.has(id)).slice(0, GAMMA_MARKET_LOOKUP_LIMIT);
  await Promise.all(
    missing.map(async (conditionId) => {
      try {
        const gamma = await fetchGammaMarket(conditionId);
        if (!gamma) return;
        meta.set(conditionId, {
          conditionId,
          tagSlugs: gamma.tagSlugs,
          category: gamma.category,
          question: gamma.question,
        });
      } catch {
        // Ignore per-market Gamma failures.
      }
    }),
  );

  return meta;
}

function toActivityInput(
  activities: Awaited<ReturnType<typeof fetchAllUserActivity>>['activities'],
): TraderInsightActivityInput[] {
  return activities.map((a) => ({
    timestamp: a.timestamp,
    conditionId: a.conditionId,
    type: a.type,
    usdcSize: a.usdcSize,
    size: a.size,
    title: a.title,
    slug: a.slug,
    side: a.side,
    outcome: a.outcome,
    transactionHash: a.transactionHash,
    price: a.price,
  }));
}

export function createTraderInsightRouter(ds: DataSource): Router {
  const router = Router();
  const presenter = new CopiedPositionPresenter(ds);

  router.get('/:address/insight', requireJwt, async (req, res) => {
    const addressParsed = addressSchema.safeParse(req.params.address);
    if (!addressParsed.success) {
      res.status(400).json({ error: 'invalid_address' });
      return;
    }

    const queryParsed = querySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }

    const address = addressParsed.data;
    const normalized = address.toLowerCase();
    const cacheKey = `${normalized}:${JSON.stringify(queryParsed.data)}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.json(cached.data);
      return;
    }

    try {
      if (queryParsed.data.refreshFunding) {
        invalidateTraderFundingCacheForAddress(normalized);
      }
      const gammaProfilePromise = fetchGammaPublicProfile(address);
      const [
        activityResult,
        positions,
        portfolioValue,
        gammaProfile,
        watchlistEntry,
        fundingResult,
      ] = await Promise.all([
        fetchAllUserActivity(address, { type: ['TRADE', 'REDEEM'] }),
        fetchUserPositions(address),
        fetchUserPortfolioValue(address),
        gammaProfilePromise,
        ds.getRepository(WatchlistEntry)
          .createQueryBuilder('w')
          .where('LOWER(w.trader_address) = :address', { address: normalized })
          .getOne(),
        gammaProfilePromise.then((profile) =>
          fetchTraderFundingAnalysis(ds, address, profile),
        ),
      ]);

      const activities = toActivityInput(activityResult.activities);
      const trades = filterTradeActivities(activities);

      const conditionIds = [
        ...trades.map((t) => t.conditionId),
        ...positions.map((p) => p.conditionId),
      ];
      const marketMeta = await loadMarketMeta(ds, conditionIds);

      const activitySummary = buildActivitySummary(trades);
      const activityTimeline = buildActivityTimeline(trades);
      const capitalSeries = buildTraderCapitalSeries(activities, portfolioValue);
      const marketBreakdown = buildMarketBreakdown(trades, marketMeta);
      const recentActivity = buildRecentActivity(trades);

      const openPositions = positions
        .filter((p) => Number(p.size) > 0)
        .map((p) => ({
          conditionId: p.conditionId,
          title: p.title?.trim() || p.slug || 'Marché inconnu',
          outcome: p.outcome?.trim() || '—',
          size: Number(p.size),
          avgPrice:
            p.avgPrice != null && Number.isFinite(Number(p.avgPrice))
              ? Number(p.avgPrice)
              : undefined,
          currentValue:
            p.currentValue != null && Number.isFinite(Number(p.currentValue))
              ? Number(p.currentValue)
              : undefined,
        }));

      let simStats = null;
      let watchlist = null;
      if (watchlistEntry) {
        watchlist = {
          id: watchlistEntry.id,
          nickname: watchlistEntry.nickname,
          simEnabled: watchlistEntry.simEnabled,
          realEnabled: watchlistEntry.realEnabled,
        };

        const simPositions = await ds.getRepository(CopiedPosition).find({
          where: { watchlistId: watchlistEntry.id, mode: 'sim' },
        });
        const enriched = await presenter.enrich(simPositions);
        const analytics = buildTraderAnalytics([watchlistEntry], enriched);
        const row = analytics.find((t) => t.watchlistId === watchlistEntry.id);
        if (row && row.positionCount > 0) {
          simStats = {
            positionCount: row.positionCount,
            totalPnl: row.totalPnl,
            winRatePercent: row.winRatePercent,
            roiPercent: row.roiPercent,
          };
        }
      }

      const q = queryParsed.data;
      const response: TraderInsightResponse = {
        address,
        profile: {
          userName:
            q.userName ||
            gammaProfile?.name ||
            gammaProfile?.pseudonym ||
            undefined,
          profileImage: q.profileImage || gammaProfile?.profileImage,
          xUsername: q.xUsername || gammaProfile?.xUsername,
          verifiedBadge: q.verifiedBadge ?? gammaProfile?.verifiedBadge,
          bio: gammaProfile?.bio,
        },
        leaderboard:
          q.leaderboardRank != null ||
          q.leaderboardPnl != null ||
          q.leaderboardVol != null
            ? {
                rank: q.leaderboardRank,
                pnl: q.leaderboardPnl,
                vol: q.leaderboardVol,
              }
            : undefined,
        portfolioValue,
        activitySummary,
        activityTimeline,
        capitalSeries,
        marketBreakdown,
        openPositions,
        recentActivity,
        watchlist,
        simStats,
        activityTruncated: activityResult.truncated,
        funding: fundingResult.ok ? fundingResult.funding : null,
        fundingUnavailableReason: fundingResult.ok
          ? undefined
          : fundingResult.reason,
        fetchedAt: new Date().toISOString(),
      };

      cache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
      res.json(response);
    } catch (err) {
      log.warn({ err, address: normalized }, 'trader insight failed');
      res.status(502).json({ error: 'polymarket_api_error' });
    }
  });

  return router;
}
