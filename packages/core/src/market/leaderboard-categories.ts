import { NAV_MARKET_TAG_SLUGS } from './tags.js';

/** Polymarket Data API `/v1/leaderboard` category parameter values. */
export const LEADERBOARD_API_CATEGORIES = [
  'OVERALL',
  'POLITICS',
  'SPORTS',
  'CRYPTO',
  'ESPORTS',
  'FINANCE',
  'TECH',
  'CULTURE',
  'ECONOMICS',
  'WEATHER',
] as const;

export type LeaderboardApiCategory = (typeof LEADERBOARD_API_CATEGORIES)[number];

const NAV_SLUG_TO_LEADERBOARD: Partial<
  Record<(typeof NAV_MARKET_TAG_SLUGS)[number], LeaderboardApiCategory>
> = {
  politics: 'POLITICS',
  sports: 'SPORTS',
  crypto: 'CRYPTO',
  esports: 'ESPORTS',
  finance: 'FINANCE',
  tech: 'TECH',
  culture: 'CULTURE',
  economy: 'ECONOMICS',
  weather: 'WEATHER',
  // geopolitics: not supported by Polymarket leaderboard API (400)
};

/** French labels — aligned with main nav market tags where applicable. */
export const LEADERBOARD_CATEGORY_LABELS_FR: Record<LeaderboardApiCategory, string> = {
  OVERALL: 'Global',
  POLITICS: 'Politique',
  SPORTS: 'Sports',
  CRYPTO: 'Crypto',
  ESPORTS: 'Esports',
  FINANCE: 'Finance',
  TECH: 'Tech',
  CULTURE: 'Culture',
  ECONOMICS: 'Économie',
  WEATHER: 'Météo',
};

export const LEADERBOARD_CATEGORY_OPTIONS: ReadonlyArray<{
  value: LeaderboardApiCategory;
  label: string;
}> = [
  { value: 'OVERALL', label: LEADERBOARD_CATEGORY_LABELS_FR.OVERALL },
  ...NAV_MARKET_TAG_SLUGS.flatMap((slug) => {
    const value = NAV_SLUG_TO_LEADERBOARD[slug];
    if (!value) return [];
    return [{ value, label: LEADERBOARD_CATEGORY_LABELS_FR[value] }];
  }),
];
