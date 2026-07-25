import { getGammaApiUrl } from '../polymarket/apis.js';

const GAMMA_TAGS_PAGE_SIZE = 500;
const GAMMA_TAGS_MAX_PAGES = 20;

/** Top-level Polymarket navigation category slugs (labels are FR in the UI). */
export const NAV_MARKET_TAG_SLUGS = [
  'politics',
  'sports',
  'crypto',
  'esports',
  'finance',
  'tech',
  'culture',
  'economy',
  'weather',
  'geopolitics',
] as const;

const NAV_TAG_FALLBACK_LABELS: Record<string, string> = {
  politics: 'Politics',
  sports: 'Sports',
  crypto: 'Crypto',
  esports: 'Esports',
  finance: 'Finance',
  tech: 'Tech',
  culture: 'Culture',
  economy: 'Economy',
  weather: 'Weather',
  geopolitics: 'Geopolitics',
};

export interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

export function normalizeCategoryToSlug(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Ensures the normalized market category slug is present in tag slugs. */
export function mergeCategoryIntoTagSlugs(
  slugs: string[],
  category: string | null | undefined,
): string[] {
  if (!category?.trim()) return slugs;
  const categorySlug = normalizeCategoryToSlug(category);
  if (slugs.includes(categorySlug)) return slugs;
  return [...slugs, categorySlug];
}

function parseTagSlug(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const slug = (value as { slug?: unknown }).slug;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
}

function collectTagSlugsFromTagsArray(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    const slug = parseTagSlug(tag);
    return slug ? [slug] : [];
  });
}

function collectSlugsFromRecord(slugs: Set<string>, record: Record<string, unknown>): void {
  if (typeof record.category === 'string' && record.category.trim()) {
    slugs.add(normalizeCategoryToSlug(record.category));
  }
  for (const slug of collectTagSlugsFromTagsArray(record.tags)) {
    slugs.add(slug);
  }
}

export function parseTagSlugsFromGammaRaw(raw: Record<string, unknown>): string[] {
  const slugs = new Set<string>();
  collectSlugsFromRecord(slugs, raw);
  if (Array.isArray(raw.events)) {
    for (const event of raw.events) {
      if (typeof event === 'object' && event !== null) {
        collectSlugsFromRecord(slugs, event as Record<string, unknown>);
      }
    }
  }
  return [...slugs];
}

export function serializeAllowedMarketTags(slugs: string[]): string {
  return JSON.stringify(slugs);
}

export function parseAllowedMarketTags(json: string | null | undefined): string[] {
  if (!json || json.trim() === '') return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
  } catch {
    return [];
  }
}

export function isMarketTagAllowed(
  marketSlugs: string[],
  allowedSlugs: string[],
): boolean {
  if (allowedSlugs.length === 0) return true;
  const allowed = new Set(allowedSlugs);
  return marketSlugs.some((slug) => allowed.has(slug));
}

export function buildNavMarketTags(): GammaTag[] {
  return NAV_MARKET_TAG_SLUGS.map((slug) => ({
    id: slug,
    label: NAV_TAG_FALLBACK_LABELS[slug] ?? slug,
    slug,
  }));
}

/** Crypto-related leaf tag slugs we want to surface as filter options. */
const CRYPTO_FILTER_TAG_SLUGS = new Set([
  'bitcoin',
  'btc',
  'ethereum',
  'eth',
  'solana',
  'xrp',
  'ripple',
  'dogecoin',
  'doge',
  'cardano',
  'polygon',
  'chainlink',
  'altcoins',
  'litecoin',
  'polkadot',
  'avalanche',
  'uniswap',
  'shiba-inu',
  'crypto-prices',
]);

export function filterCryptoTags(tags: GammaTag[]): GammaTag[] {
  return tags.filter((tag) => CRYPTO_FILTER_TAG_SLUGS.has(tag.slug.toLowerCase()));
}

export async function fetchGammaEventRecord(
  slug: string | null,
  id: string | null,
): Promise<Record<string, unknown> | null> {
  if (slug) {
    const res = await fetch(
      `${getGammaApiUrl()}/events?slug=${encodeURIComponent(slug)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
        return data[0] as Record<string, unknown>;
      }
    }
  }
  if (id) {
    const res = await fetch(`${getGammaApiUrl()}/events/${id}`);
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (typeof data === 'object' && data !== null) {
        return data as Record<string, unknown>;
      }
    }
  }
  return null;
}

/**
 * Gamma `/markets` embeds events without tag arrays — load linked events
 * to resolve slugs used by the copy-trading market filter.
 */
export async function enrichGammaMarketTags(
  market: { category: string | null; tagSlugs: string[] },
  raw: Record<string, unknown>,
): Promise<void> {
  const slugs = new Set(market.tagSlugs);
  if (!Array.isArray(raw.events)) {
    market.tagSlugs = [...slugs];
    return;
  }

  for (const item of raw.events) {
    if (typeof item !== 'object' || item === null) continue;
    const event = item as Record<string, unknown>;

    for (const slug of parseTagSlugsFromGammaRaw(event)) {
      slugs.add(slug);
    }

    const hasInlineTags =
      Array.isArray(event.tags) && event.tags.length > 0;
    if (hasInlineTags) continue;

    const eventSlug = typeof event.slug === 'string' ? event.slug : null;
    const eventId = event.id != null ? String(event.id) : null;
    const full = await fetchGammaEventRecord(eventSlug, eventId);
    if (!full) continue;

    for (const slug of parseTagSlugsFromGammaRaw(full)) {
      slugs.add(slug);
    }
    if (!market.category && typeof full.category === 'string') {
      market.category = full.category;
    }
  }

  market.tagSlugs = [...slugs];
}

function parseGammaTagRecord(raw: Record<string, unknown>): GammaTag | null {
  const id = raw.id != null ? String(raw.id) : null;
  const label = typeof raw.label === 'string' ? raw.label : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  if (!id || !label || !slug) return null;
  return { id, label, slug };
}

export async function fetchGammaTags(): Promise<GammaTag[]> {
  const tags: GammaTag[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < GAMMA_TAGS_MAX_PAGES; page++) {
    const offset = page * GAMMA_TAGS_PAGE_SIZE;
    const params = new URLSearchParams({
      limit: String(GAMMA_TAGS_PAGE_SIZE),
      offset: String(offset),
    });
    const res = await fetch(`${getGammaApiUrl()}/tags?${params}`);
    if (!res.ok) break;

    const batch = (await res.json()) as Record<string, unknown>[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const raw of batch) {
      const tag = parseGammaTagRecord(raw);
      if (!tag || seen.has(tag.slug)) continue;
      seen.add(tag.slug);
      tags.push(tag);
    }

    if (batch.length < GAMMA_TAGS_PAGE_SIZE) break;
  }

  return tags;
}

export function filterGammaTags(tags: GammaTag[], search: string): GammaTag[] {
  const q = search.trim().toLowerCase();
  if (!q) return tags;
  return tags.filter(
    (t) =>
      t.slug.toLowerCase().includes(q) || t.label.toLowerCase().includes(q),
  );
}

/** Gamma slugs that identify crypto leaf tags (Polymarket /tags API). */
const CRYPTO_LEAF_TAG_SLUGS = new Set([
  'bitcoin',
  'btc',
  'ethereum',
  'eth',
  'solana',
  'xrp',
  'ripple',
  'dogecoin',
  'doge',
  'cardano',
  'polygon',
  'chainlink',
  'altcoins',
  'defi',
  'nft',
  'crypto-prices',
  'microstrategy',
]);

/** Returns tags that represent crypto assets/categories from Polymarket's /tags list. */
export function filterCryptoGammaTags(tags: GammaTag[]): GammaTag[] {
  return tags.filter(
    (t) =>
      CRYPTO_LEAF_TAG_SLUGS.has(t.slug.toLowerCase()) ||
      /\b(bitcoin|ethereum|solana|xrp|dogecoin|crypto)\b/i.test(t.label),
  );
}

const tagIdBySlugCache = new Map<string, string>();

async function fetchGammaTagIdBySlug(normalized: string): Promise<string | null> {
  const res = await fetch(
    `${getGammaApiUrl()}/tags/slug/${encodeURIComponent(normalized)}`,
  );
  if (!res.ok) return null;

  const raw = (await res.json()) as Record<string, unknown>;
  const tag = parseGammaTagRecord(raw);
  if (tag?.slug.toLowerCase() !== normalized) return null;
  return tag.id;
}

export async function resolveGammaTagIdBySlug(slug: string): Promise<string | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;

  const cached = tagIdBySlugCache.get(normalized);
  if (cached) return cached;

  const tagId = await fetchGammaTagIdBySlug(normalized);
  if (tagId) tagIdBySlugCache.set(normalized, tagId);
  return tagId;
}
