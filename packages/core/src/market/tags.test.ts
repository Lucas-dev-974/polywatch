import { describe, expect, it, vi } from 'vitest';
import {
  buildNavMarketTags,
  enrichGammaMarketTags,
  filterGammaTags,
  isMarketTagAllowed,
  normalizeCategoryToSlug,
  parseAllowedMarketTags,
  parseTagSlugsFromGammaRaw,
  serializeAllowedMarketTags,
} from './tags.js';

describe('market tags', () => {
  it('normalizes category labels to slugs', () => {
    expect(normalizeCategoryToSlug('Sports')).toBe('sports');
    expect(normalizeCategoryToSlug('Pop Culture')).toBe('pop-culture');
  });

  it('parses tag slugs from gamma raw market records', () => {
    const slugs = parseTagSlugsFromGammaRaw({
      category: 'Sports',
      tags: [{ slug: 'nba' }, { slug: 'basketball' }],
      events: [
        {
          category: 'Crypto',
          tags: [{ slug: 'bitcoin' }],
        },
      ],
    });
    expect(slugs).toEqual(
      expect.arrayContaining(['sports', 'nba', 'basketball', 'crypto', 'bitcoin']),
    );
    expect(slugs).toHaveLength(5);
  });

  it('allows all markets when the whitelist is empty', () => {
    expect(isMarketTagAllowed(['sports'], [])).toBe(true);
    expect(isMarketTagAllowed([], ['sports'])).toBe(false);
  });

  it('allows markets with at least one matching tag', () => {
    expect(isMarketTagAllowed(['sports', 'nba'], ['crypto', 'nba'])).toBe(true);
    expect(isMarketTagAllowed(['politics'], ['sports'])).toBe(false);
  });

  it('serializes and parses allowed market tags safely', () => {
    const json = serializeAllowedMarketTags(['sports', 'crypto']);
    expect(parseAllowedMarketTags(json)).toEqual(['sports', 'crypto']);
    expect(parseAllowedMarketTags('not-json')).toEqual([]);
    expect(parseAllowedMarketTags(null)).toEqual([]);
  });

  it('builds nav market tags without calling gamma', () => {
    expect(buildNavMarketTags()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'politics', label: 'Politics' }),
        expect.objectContaining({ slug: 'sports', label: 'Sports' }),
      ]),
    );
    expect(buildNavMarketTags()).toHaveLength(10);
  });

  it('enriches market tags from linked gamma events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            slug: 'nba-game',
            tags: [{ slug: 'sports' }, { slug: 'nba' }],
          },
        ],
      }),
    );

    const market = { category: null as string | null, tagSlugs: [] as string[] };
    await enrichGammaMarketTags(market, {
      events: [{ id: '1', slug: 'nba-game' }],
    });

    expect(market.tagSlugs).toEqual(
      expect.arrayContaining(['sports', 'nba']),
    );
    vi.unstubAllGlobals();
  });

  it('filters tags by search query', () => {
    const tags = [
      { id: '1', label: 'NBA', slug: 'nba' },
      { id: '2', label: 'Politics', slug: 'politics' },
    ];
    expect(filterGammaTags(tags, 'nba')).toHaveLength(1);
    expect(filterGammaTags(tags, 'pol')).toHaveLength(1);
    expect(filterGammaTags(tags, '')).toHaveLength(2);
  });

  it('resolves gamma tag ids by slug via /tags/slug/{slug}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '2',
          label: 'Politics',
          slug: 'politics',
        }),
      }),
    );

    const { resolveGammaTagIdBySlug } = await import('./tags.js');
    await expect(resolveGammaTagIdBySlug('politics')).resolves.toBe('2');
    expect(fetch).toHaveBeenCalledWith(
      'https://gamma-api.polymarket.com/tags/slug/politics',
    );

    vi.unstubAllGlobals();
  });
});
