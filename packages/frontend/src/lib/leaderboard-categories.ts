import { NAV_TAG_LABELS_FR } from './market-tags';

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

const NAV_SLUG_TO_LEADERBOARD: Record<string, LeaderboardApiCategory> = {
  politics: 'POLITICS',
  sports: 'SPORTS',
  crypto: 'CRYPTO',
  esports: 'ESPORTS',
  finance: 'FINANCE',
  tech: 'TECH',
  culture: 'CULTURE',
  economy: 'ECONOMICS',
  weather: 'WEATHER',
};

/** Main nav market tags exposed as leaderboard filter options (FR labels). */
export const LEADERBOARD_CATEGORY_OPTIONS: ReadonlyArray<{
  value: LeaderboardApiCategory;
  label: string;
}> = [
  { value: 'OVERALL', label: 'Global' },
  ...Object.entries(NAV_SLUG_TO_LEADERBOARD).map(([slug, value]) => ({
    value,
    label: NAV_TAG_LABELS_FR[slug] ?? slug,
  })),
];
