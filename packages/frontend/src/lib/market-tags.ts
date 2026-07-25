import { api } from '../api';
import { resolveMarketNavCategoryLabel } from '@polywatch/core/market/nav-category';

export interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

export interface MarketTagsResponse {
  nav: GammaTag[];
  tags: GammaTag[];
  cryptoTags: GammaTag[];
}

export async function fetchMarketTags(): Promise<MarketTagsResponse> {
  return api<MarketTagsResponse>('/market-tags');
}

export async function searchMarketTags(query: string): Promise<GammaTag[]> {
  const params = new URLSearchParams({ search: query });
  const data = await api<MarketTagsResponse>(`/market-tags?${params}`);
  return data.tags;
}

export async function fetchCryptoMarketTags(): Promise<GammaTag[]> {
  const data = await api<MarketTagsResponse>('/market-tags');
  return data.cryptoTags ?? [];
}

/** French labels for Polymarket nav category slugs. */
export const NAV_TAG_LABELS_FR: Record<string, string> = {
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
  other: 'Autre',
};

/** FR label for a tag slug, falling back to a humanized slug. */
export function marketTagSlugLabel(slug: string): string {
  return NAV_TAG_LABELS_FR[slug] ?? slug.replace(/-/g, ' ');
}

export function marketTagLabel(tag: GammaTag): string {
  return NAV_TAG_LABELS_FR[tag.slug] ?? tag.label;
}

/** Prefer a nav category, else the first available slug. */
export function primaryMarketTagSlug(
  slugs: string[] | null | undefined,
): string | null {
  if (!slugs?.length) return null;
  const navSet = new Set(Object.keys(NAV_TAG_LABELS_FR));
  return slugs.find((slug) => navSet.has(slug)) ?? slugs[0];
}

export function primaryMarketTagLabel(
  slugs: string[] | null | undefined,
  category?: string | null,
  question?: string | null,
): string | null {
  return (
    resolveMarketNavCategoryLabel(slugs, category, question) ??
    (slugs?.length ? marketTagSlugLabel(slugs[0]!) : null)
  );
}
