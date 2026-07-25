import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Market } from '../entities/Market.js';
import { marketClassifier } from '../market/classifier.js';
import { shouldSyncPriceHistory } from '../market/behavior-registry.js';
import {
  mergeCategoryIntoTagSlugs,
  parseAllowedMarketTags,
  serializeAllowedMarketTags,
} from '../market/tags.js';
import {
  fetchGammaMarket,
  fetchClobMarketFeeParams,
  type GammaMarket,
} from '../polymarket/market-metadata.js';
import {
  mergeStableBinaryTokenSlots,
  outcomesFromPairsWithSlots,
  serializeMarketOutcomes,
} from '../polymarket/outcome-tokens.js';
import {
  marketPlatformFeeParams,
  type PlatformFeeParams,
  ZERO_PLATFORM_FEE,
} from '../pricing/fees.js';
import { buildPolymarketMarketUrl } from '../polymarket/url.js';

/** TTL for fetchAndPersist results to avoid redundant Gamma API calls (OPT-15). */
const FETCH_CACHE_TTL_MS = 60_000;

/** Max parallel Gamma fetches during resolveMany bursts (positions page, etc.). */
const RESOLVE_FETCH_CONCURRENCY = 8;

/** Pre-close window for refreshing display metadata from Gamma. */
const RESOLVE_REFRESH_PRE_CLOSE_SEC = 60;

/** In-memory TTL cache for fetchAndPersist results keyed by conditionId. */
const fetchCache = new Map<string, { data: GammaMarket | null; expiresAt: number }>();
const FETCH_CACHE_MAX = 500;

/** Promesses d'appels API externes en cours pour éviter les doublons concurrents. */
const pendingFetchCache = new Map<string, Promise<GammaMarket | null>>();

function setFetchCache(conditionId: string, data: GammaMarket | null): void {
  // LRU eviction at capacity
  if (fetchCache.size >= FETCH_CACHE_MAX) {
    const oldest = fetchCache.keys().next().value;
    if (oldest !== undefined) fetchCache.delete(oldest);
  }
  fetchCache.set(conditionId, {
    data,
    expiresAt: Date.now() + FETCH_CACHE_TTL_MS,
  });
}

/**
 * Whether resolveMany should hit Gamma for this row. Uses DB when display
 * metadata is already persisted and the market is not near its end time.
 */
export function needsGammaRefreshForResolve(
  stored: Pick<Market, 'question' | 'slug' | 'resolved' | 'endDate'> | undefined,
): boolean {
  if (!stored) return true;
  if (!stored.question && !stored.slug) return true;
  if (!stored.endDate) return true;
  if (!stored.resolved) {
    const timeToEndMs = stored.endDate.getTime() - Date.now();
    if (timeToEndMs <= RESOLVE_REFRESH_PRE_CLOSE_SEC * 1000) return true;
  }
  return false;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) break;
        await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

async function fetchGammaMarketOnce(conditionId: string): Promise<GammaMarket | null> {
  const existing = pendingFetchCache.get(conditionId);
  if (existing) return existing;

  const promise = fetchGammaMarket(conditionId).finally(() => {
    pendingFetchCache.delete(conditionId);
  });
  pendingFetchCache.set(conditionId, promise);
  return promise;
}

export interface ResolvedMarket {
  conditionId: string;
  question: string | null;
  slug: string | null;
  /** Slug of the parent event page on polymarket.com. */
  eventSlug: string | null;
  url: string;
  endDate: string | null;
  tagSlugs: string[];
  category: string | null;
  /** Market is resolved (payout known). */
  resolved: boolean;
  /** Market is closed (no longer accepting new orders). */
  closed: boolean;
  icon: string | null;
}

export { shouldPollMarketForLifecycle } from '../market/lifecycle.js';

function readCachedTagSlugs(stored: Market | null | undefined): string[] | null {
  if (!stored) return null;
  const tags = parseAllowedMarketTags(stored.tagSlugs);
  if (tags.length > 0) return tags;
  if (stored.category != null) return tags;
  return null;
}

function resolveMarketCategory(
  fetched: GammaMarket | null,
  stored?: Market | null,
): string | null {
  return fetched?.category ?? stored?.category ?? null;
}

function selectTagSlugs(
  fetched: GammaMarket | null,
  stored?: Market | null,
): string[] {
  const category = resolveMarketCategory(fetched, stored);
  const storedTags = stored ? parseAllowedMarketTags(stored.tagSlugs) : [];
  const fetchedTags = fetched?.tagSlugs ?? [];
  const merged = [...new Set([...storedTags, ...fetchedTags])];
  return mergeCategoryIntoTagSlugs(merged, category);
}

function toResolvedMarket(
  conditionId: string,
  fetched: GammaMarket | null,
  stored?: Market | null,
): ResolvedMarket {
  const slug = fetched?.slug ?? stored?.slug ?? null;
  const eventSlug = fetched?.eventSlug ?? stored?.eventSlug ?? null;
  const endDate =
    fetched?.endDate ??
    (stored?.endDate ? stored.endDate.toISOString() : null);
  return {
    conditionId,
    question: fetched?.question ?? stored?.question ?? null,
    slug,
    eventSlug,
    url: buildPolymarketMarketUrl(eventSlug, slug, conditionId),
    endDate,
    tagSlugs: selectTagSlugs(fetched, stored),
    category: resolveMarketCategory(fetched, stored),
    resolved: fetched?.resolved ?? stored?.resolved ?? false,
    closed: fetched?.closed ?? stored?.closed ?? false,
    icon: fetched?.icon ?? stored?.icon ?? null,
  };
}

export class MarketService {
  constructor(private readonly ds: DataSource) {}

  async loadByConditionIds(conditionIds: string[]): Promise<Map<string, Market>> {
    const unique = [...new Set(conditionIds)];
    if (unique.length === 0) return new Map();

    const rows = await this.ds
      .getRepository(Market)
      .createQueryBuilder('m')
      .where('m.condition_id IN (:...ids)', { ids: unique })
      .getMany();
    return new Map(rows.map((m) => [m.conditionId, m]));
  }

  /**
   * Return a persisted {@link Market} row with token ids, fetching from Gamma
   * when the row is missing or incomplete. Used by crypto-algo selection sync.
   */
  async ensureTradableMarket(conditionId: string): Promise<Market | null> {
    const stored = await this.loadByConditionIds([conditionId]);
    const existing = stored.get(conditionId);
    if (existing?.tokenIdYes) {
      return existing;
    }

    try {
      await this.fetchAndPersist(conditionId);
    } catch {
      return null;
    }

    const refreshed = await this.loadByConditionIds([conditionId]);
    const market = refreshed.get(conditionId);
    return market?.tokenIdYes ? market : null;
  }

  async fetchAndPersist(conditionId: string): Promise<GammaMarket | null> {
    // TTL cache hit — skip redundant Gamma API call
    const cached = fetchCache.get(conditionId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const fetched = await fetchGammaMarketOnce(conditionId);
    setFetchCache(conditionId, fetched);

    if (!fetched) return null;

    const repo = this.ds.getRepository(Market);
    const byId = new Map<string, Market>();
    const existing = await repo.findOne({ where: { conditionId } });
    if (existing) byId.set(conditionId, existing);
    await this.persistMarket(repo, byId, conditionId, fetched);
    return fetched;
  }

  async resolveTagSlugs(conditionId: string): Promise<string[]> {
    const repo = this.ds.getRepository(Market);
    const stored = await repo.findOne({ where: { conditionId } });
    const cached = readCachedTagSlugs(stored);
    if (cached !== null) return cached;

    const fetched = await fetchGammaMarketOnce(conditionId);
    if (!fetched) return [];

    const byId = new Map<string, Market>();
    if (stored) byId.set(conditionId, stored);
    await this.persistMarket(repo, byId, conditionId, fetched);
    return fetched.tagSlugs;
  }

  async saveResolution(
    conditionId: string,
    winningTokenId: string,
    manager?: EntityManager,
  ): Promise<Market> {
    const repo = (manager ?? this.ds.manager).getRepository(Market);
    let market = await repo.findOne({ where: { conditionId } });
    if (!market) {
      market = repo.create({ conditionId });
    }
    market.resolved = true;
    market.closed = true;
    market.acceptingOrders = false;
    market.winningTokenId = winningTokenId;
    market.updatedAt = new Date();
    return repo.save(market);
  }

  async resolve(conditionId: string): Promise<ResolvedMarket> {
    const map = await this.resolveMany([conditionId]);
    return map.get(conditionId)!;
  }

  async resolveMany(
    conditionIds: string[],
  ): Promise<Map<string, ResolvedMarket>> {
    const unique = [...new Set(conditionIds)];
    if (unique.length === 0) return new Map();

    const repo = this.ds.getRepository(Market);
    const byId = await this.loadByConditionIds(unique);

    // Refresh only rows missing display metadata or near end-of-market; cap
    // concurrency so a positions page does not open hundreds of Gamma sockets.
    const fetchedByCondition = new Map<string, GammaMarket | null>();
    const toFetch = unique.filter((conditionId) =>
      needsGammaRefreshForResolve(byId.get(conditionId)),
    );
    await runWithConcurrency(toFetch, RESOLVE_FETCH_CONCURRENCY, async (conditionId) => {
      const fetched = await this.fetchAndPersist(conditionId);
      fetchedByCondition.set(conditionId, fetched);
    });

    const refreshedById =
      toFetch.length > 0
        ? await this.loadByConditionIds(unique)
        : byId;

    const entries = unique.map((conditionId) => {
      const fetched = fetchedByCondition.get(conditionId) ?? null;
      const stored = refreshedById.get(conditionId) ?? byId.get(conditionId);
      return [
        conditionId,
        toResolvedMarket(conditionId, fetched, stored),
      ] as const;
    });

    return new Map(entries);
  }

  private async persistMarket(
    repo: Repository<Market>,
    byId: Map<string, Market>,
    conditionId: string,
    fetched: GammaMarket,
  ): Promise<void> {
    let market = byId.get(conditionId);
    if (!market) {
      market = repo.create({ conditionId });
      byId.set(conditionId, market);
    }

    if (fetched.question) market.question = fetched.question;
    if (fetched.slug) market.slug = fetched.slug;
    if (fetched.eventSlug) market.eventSlug = fetched.eventSlug;
    if (fetched.endDate) market.endDate = new Date(fetched.endDate);
    market.negRisk = fetched.negRisk;

    const stableSlots = mergeStableBinaryTokenSlots(
      { tokenIdYes: market.tokenIdYes, tokenIdNo: market.tokenIdNo },
      { tokenIdYes: fetched.tokenIdYes, tokenIdNo: fetched.tokenIdNo },
    );
    if (stableSlots.tokenIdYes) market.tokenIdYes = stableSlots.tokenIdYes;
    if (stableSlots.tokenIdNo) market.tokenIdNo = stableSlots.tokenIdNo;

    if (market.tokenIdYes && market.tokenIdNo && fetched.outcomeTokens.length > 0) {
      const pairs = fetched.outcomeTokens.map((t) => ({
        outcome: t.label,
        tokenId: t.tokenId,
      }));
      market.outcomes = serializeMarketOutcomes(
        outcomesFromPairsWithSlots(pairs, market.tokenIdYes, market.tokenIdNo),
      );
    }

    market.feeRate = fetched.feeRate;
    market.feeExponent = fetched.feeExponent;
    if (fetched.winningTokenId) market.winningTokenId = fetched.winningTokenId;
    market.active = fetched.active;
    market.resolved = fetched.resolved;
    market.closed = fetched.closed;
    if (fetched.acceptingOrders !== null) {
      market.acceptingOrders = fetched.acceptingOrders;
    }
    if (fetched.category) market.category = fetched.category;
    if (fetched.icon) market.icon = fetched.icon;
    market.tagSlugs = serializeAllowedMarketTags(
      mergeCategoryIntoTagSlugs(
        [...new Set([
          ...parseAllowedMarketTags(market.tagSlugs),
          ...fetched.tagSlugs,
        ])],
        fetched.category ?? market.category,
      ),
    );
    // §9.9 : Recalculer marketType à chaque persistMarket (pas seulement à l'insertion)
    // pour que la classification reste fraîche si la question change.
    market.marketType = marketClassifier.classify({
      question: fetched.question ?? market.question,
      category: fetched.category ?? market.category,
      tagSlugs: [...new Set([
        ...parseAllowedMarketTags(market.tagSlugs),
        ...fetched.tagSlugs,
      ])],
    });
    market.updatedAt = new Date();

    await repo.save(market);
  }

  /** Platform fee params for taker fills — DB first, then live CLOB `/clob-markets`. */
  async resolvePlatformFeeParams(conditionId: string): Promise<PlatformFeeParams> {
    const repo = this.ds.getRepository(Market);
    const stored = await repo.findOne({ where: { conditionId } });
    const cached = marketPlatformFeeParams(stored);
    if (cached.feeRate > 0) return cached;

    const live = await fetchClobMarketFeeParams(conditionId);
    if (live?.feeRate && live.feeRate > 0) {
      await this.fetchAndPersist(conditionId);
      return {
        feeRate: live.feeRate,
        feeExponent: live.feeExponent > 0 ? live.feeExponent : 1,
      };
    }

    return ZERO_PLATFORM_FEE;
  }

  /**
   * Vérifie si un marché doit être exclu du sync d'historique de prix.
   * Helper partagé qui remplace les duplications de `shouldSkipSync()` dans les services.
   */
  async shouldSkipSync(conditionId: string): Promise<boolean> {
    try {
      const markets = await this.loadByConditionIds([conditionId]);
      const market = markets.get(conditionId);
      if (!market) return false;
      return !shouldSyncPriceHistory(market.marketType);
    } catch {
      return false;
    }
  }
}
