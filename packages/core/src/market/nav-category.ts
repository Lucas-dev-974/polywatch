import {
  mergeCategoryIntoTagSlugs,
  NAV_MARKET_TAG_SLUGS,
  normalizeCategoryToSlug,
} from './tags.js';

export type MarketNavCategorySlug = (typeof NAV_MARKET_TAG_SLUGS)[number];

export const MARKET_NAV_CATEGORY_LABELS: Record<MarketNavCategorySlug, string> =
  {
    politics: 'Politique',
    sports: 'Sports',
    crypto: 'Crypto',
    esports: 'Esports',
    finance: 'Finance',
    tech: 'Tech',
    culture: 'Culture',
    economy: 'Économie',
    weather: 'Météo',
    geopolitics: 'Géopolitique',
  };

const NAV_TAG_SET = new Set<string>(NAV_MARKET_TAG_SLUGS);

/** Gamma category labels that normalize to a slug outside nav. */
const CATEGORY_SLUG_ALIASES: Record<string, MarketNavCategorySlug> = {
  'pop-culture': 'culture',
  economics: 'economy',
};

const WEATHER_LEAF_TAGS = new Set([
  'weather',
  'climate',
  'global-temp',
  'daily-temperature',
  'highest-temperature',
  'temperature',
  'meteo',
]);

const CRYPTO_LEAF_TAGS = new Set([
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

const ESPORTS_LEAF_TAGS = new Set([
  'esports',
  'esport',
  'league-of-legends',
  'lol',
  'cs2',
  'counter-strike',
  'dota-2',
  'dota2',
  'valorant',
  'overwatch',
  'overwatch-2',
  'call-of-duty',
  'cod',
]);

const SPORTS_LEAF_TAGS = new Set([
  'nba',
  'nfl',
  'mlb',
  'nhl',
  'soccer',
  'epl',
  'ufc',
  'mma',
  'tennis',
  'golf',
  'f1',
  'formula-1',
  'cricket',
  'rugby',
  'basketball',
  'football',
  'baseball',
  'hockey',
  'college-football',
  'college-basketball',
  'ncaa',
  'mls',
  'premier-league',
  'champions-league',
  'boxing',
  'wwe',
  'wnba',
  'fifa-world-cup',
  'world-cup',
  'games',
]);

export function resolvePrimaryNavTagSlug(
  slugs: string[] | null | undefined,
): string | null {
  if (!slugs?.length) return null;
  return slugs.find((slug) => NAV_TAG_SET.has(slug)) ?? null;
}

function normalizeNavCategorySlug(
  slug: string,
): MarketNavCategorySlug | null {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;
  if (NAV_TAG_SET.has(normalized)) {
    return normalized as MarketNavCategorySlug;
  }
  return CATEGORY_SLUG_ALIASES[normalized] ?? null;
}

function normalizeCategoryLabel(
  category: string | null | undefined,
): MarketNavCategorySlug | null {
  if (!category?.trim()) return null;
  return normalizeNavCategorySlug(normalizeCategoryToSlug(category));
}

function inferNavCategoryFromLeafSlug(
  slug: string,
): MarketNavCategorySlug | null {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;

  if (
    WEATHER_LEAF_TAGS.has(normalized) ||
    normalized.includes('temperature') ||
    normalized.includes('weather')
  ) {
    return 'weather';
  }

  if (
    ESPORTS_LEAF_TAGS.has(normalized) ||
    normalized.includes('esport')
  ) {
    return 'esports';
  }

  if (
    CRYPTO_LEAF_TAGS.has(normalized) ||
    normalized.includes('bitcoin') ||
    normalized.includes('ethereum') ||
    (normalized.includes('crypto') && !normalized.includes('cryptography'))
  ) {
    return 'crypto';
  }

  if (
    SPORTS_LEAF_TAGS.has(normalized) ||
    normalized.includes('world-cup') ||
    normalized.includes('soccer')
  ) {
    return 'sports';
  }

  return null;
}

function inferNavCategoryFromQuestion(
  question: string | null | undefined,
): MarketNavCategorySlug | null {
  if (!question?.trim()) return null;
  const q = question.toLowerCase();

  if (
    /\bhighest temperature\b/.test(q) ||
    /\btemperature in\b/.test(q) ||
    /°[cf]\b/.test(q) ||
    /\b(rainfall|hurricane|snowfall|weather)\b/.test(q)
  ) {
    return 'weather';
  }

  if (
    /\b(bitcoin|ethereum|solana|xrp|dogecoin|crypto)\b/.test(q) ||
    (q.includes('up or down') &&
      /\b(bitcoin|ethereum|solana|xrp|dogecoin)\b/.test(q))
  ) {
    return 'crypto';
  }

  if (
    /\b(nba|nfl|mlb|nhl|ufc|tennis|soccer|world cup|wnba)\b/.test(q)
  ) {
    return 'sports';
  }

  if (/\b(esport|cs2|dota|valorant|league of legends)\b/.test(q)) {
    return 'esports';
  }

  return null;
}

/**
 * Maps a market to a Polymarket nav category.
 * Uses nav slugs, Gamma category, leaf tags, then market question.
 */
export function resolveMarketNavCategorySlug(
  slugs: string[] | null | undefined,
  category?: string | null,
  question?: string | null,
): MarketNavCategorySlug | null {
  const merged = mergeCategoryIntoTagSlugs(slugs ?? [], category);

  const fromCategory = normalizeCategoryLabel(category);
  if (fromCategory) return fromCategory;

  for (const slug of merged) {
    const nav = normalizeNavCategorySlug(slug);
    if (nav) return nav;
  }

  for (const slug of merged) {
    const inferred = inferNavCategoryFromLeafSlug(slug);
    if (inferred) return inferred;
  }

  return inferNavCategoryFromQuestion(question);
}

export function marketNavCategoryLabel(
  slug: MarketNavCategorySlug,
): string {
  return MARKET_NAV_CATEGORY_LABELS[slug];
}

export function resolveMarketNavCategoryLabel(
  slugs: string[] | null | undefined,
  category?: string | null,
  question?: string | null,
): string | null {
  const slug = resolveMarketNavCategorySlug(slugs, category, question);
  return slug ? marketNavCategoryLabel(slug) : null;
}
