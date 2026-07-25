import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractMarketIcon, fetchGammaMarket } from './market-metadata.js';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe('fetchGammaMarket', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects the matching open gamma market by condition id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            conditionId: '0xother',
            question: 'Wrong market',
            slug: 'wrong',
          },
          {
            conditionId: '0xabc',
            question: 'Target market?',
            slug: 'target-market',
            clobTokenIds: '["111","222"]',
            outcomes: '["Up","Down"]',
          },
        ]),
      ),
    );

    const result = await fetchGammaMarket('0xabc');

    expect(result).toMatchObject({
      question: 'Target market?',
      slug: 'target-market',
      tokenIdYes: '111',
      tokenIdNo: '222',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://gamma-api.polymarket.com/markets?condition_ids=0xabc',
    );
  });

  it('falls back to closed gamma markets when open lookup is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(
          jsonResponse([
            {
              conditionId: '0xclosed',
              question: 'Closed market?',
              slug: 'closed-market',
              clobTokenIds: '["1","2"]',
              outcomes: '["Yes","No"]',
            },
          ]),
        ),
    );

    const result = await fetchGammaMarket('0xclosed');

    expect(result?.question).toBe('Closed market?');
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://gamma-api.polymarket.com/markets?condition_ids=0xclosed&closed=true',
    );
  });

  it('derives the winning token from resolved gamma outcome prices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            conditionId: '0xres',
            question: 'Resolved market?',
            slug: 'resolved-market',
            clobTokenIds: '["111","222"]',
            outcomes: '["Yes","No"]',
            outcomePrices: '["0","1"]',
            resolved: true,
          },
        ]),
      ),
    );

    const result = await fetchGammaMarket('0xres');

    expect(result).toMatchObject({
      resolved: true,
      winningTokenId: '222',
    });
  });

  it('returns null winning token when the market is not resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            conditionId: '0xopen',
            question: 'Open market?',
            slug: 'open-market',
            clobTokenIds: '["111","222"]',
            outcomes: '["Yes","No"]',
            outcomePrices: '["0.62","0.38"]',
            resolved: false,
          },
        ]),
      ),
    );

    const result = await fetchGammaMarket('0xopen');

    expect(result?.resolved).toBe(false);
    expect(result?.winningTokenId).toBeNull();
  });

  it('derives the winning token from a clob winner flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(
          jsonResponse({
            condition_id: '0xclobwin',
            question: 'CLOB resolved?',
            market_slug: 'clob-resolved',
            closed: true,
            tokens: [
              { token_id: '10', outcome: 'Yes', winner: false },
              { token_id: '20', outcome: 'No', winner: true },
            ],
          }),
        ),
    );

    const result = await fetchGammaMarket('0xclobwin');

    // CLOB `closed` does NOT imply `resolved` — settlement is detected via
    // isMarketSettled (winner + closed + accepting_orders === false).
    expect(result).toMatchObject({
      resolved: false,
      closed: true,
      winningTokenId: '20',
    });
  });

  it('falls back to clob when gamma has no match', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(
          jsonResponse({
            condition_id: '0xclob',
            question: 'CLOB market?',
            market_slug: 'clob-market',
            closed: true,
            tokens: [
              { token_id: '10', outcome: 'Up' },
              { token_id: '20', outcome: 'Down' },
            ],
          }),
        ),
    );

    const result = await fetchGammaMarket('0xclob');

    expect(result).toMatchObject({
      question: 'CLOB market?',
      slug: 'clob-market',
      tokenIdYes: '10',
      tokenIdNo: '20',
      // `closed: true` alone no longer marks the market as resolved.
      resolved: false,
      closed: true,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://clob.polymarket.com/markets/0xclob',
    );
  });

  it('enriches platform fee params from clob-markets', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([
            {
              conditionId: '0xfee',
              question: 'Fee market?',
              slug: 'fee-market',
              clobTokenIds: '["111","222"]',
              outcomes: '["Yes","No"]',
            },
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            fd: { r: 0.07, e: 1, to: true },
          }),
        ),
    );

    const result = await fetchGammaMarket('0xfee');

    expect(result).toMatchObject({
      feeRate: 0.07,
      feeExponent: 1,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://clob.polymarket.com/clob-markets/0xfee',
    );
  });

  it('enriches tag slugs from linked gamma events when market payload omits tags', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          jsonResponse([
            {
              conditionId: '0xsports',
              question: 'Knicks vs. Cavaliers?',
              slug: 'knicks-cavaliers',
              clobTokenIds: '["111","222"]',
              outcomes: '["Knicks","Cavaliers"]',
              events: [{ id: '496955', slug: 'nba-nyk-cle-2026-05-23' }],
            },
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse([
            {
              slug: 'nba-nyk-cle-2026-05-23',
              tags: [
                { slug: 'sports' },
                { slug: 'nba' },
                { slug: 'basketball' },
              ],
            },
          ]),
        ),
    );

    const result = await fetchGammaMarket('0xsports');

    expect(result?.tagSlugs).toEqual(
      expect.arrayContaining(['sports', 'nba', 'basketball']),
    );
    expect(result?.eventSlug).toBe('nba-nyk-cle-2026-05-23');
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://gamma-api.polymarket.com/events?slug=nba-nyk-cle-2026-05-23',
    );
  });
});

describe('extractMarketIcon', () => {
  it('prefers icon, then image, then linked event artwork', () => {
    expect(
      extractMarketIcon({
        icon: 'https://example.com/icon.png',
        image: 'https://example.com/image.png',
      }),
    ).toBe('https://example.com/icon.png');

    expect(
      extractMarketIcon({
        image: 'https://example.com/image.png',
      }),
    ).toBe('https://example.com/image.png');

    expect(
      extractMarketIcon({
        events: [{ icon: 'https://example.com/event-icon.png' }],
      }),
    ).toBe('https://example.com/event-icon.png');
  });
});
