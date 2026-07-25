import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isMarketLiveNow,
  isGammaMarketLiveNow,
  isGammaMarketValidForAutoTrack,
  pickBestAutoTrackMarket,
  pickBestFutureAutoTrackMarket,
} from './auto-track-discovery.js';
import type { MarketListItemDto } from './market-list.js';
import { MarketType } from '../market/market-type.js';

function makeItem(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
  return {
    conditionId: '0xabc',
    question: 'Bitcoin Up or Down - June 25, 4:50AM-4:55AM',
    slug: 'test',
    eventSlug: 'test-event',
    icon: null,
    endDate: new Date(Date.now() + 300_000).toISOString(),
    startDate: new Date(Date.now() - 60_000).toISOString(),
    volume: 1000,
    volume24hr: 500,
    liquidityClob: 200,
    outcomePrices: [{ outcome: 'Up', price: 0.5 }, { outcome: 'Down', price: 0.5 }],
    outcomes: [
      { label: 'Up', tokenId: '0x1', side: 0 },
      { label: 'Down', tokenId: '0x2', side: 1 },
    ],
    acceptingOrders: true,
    closed: false,
    url: 'https://polymarket.com/event/test',
    tokenIdYes: '0x1',
    tokenIdNo: '0x2',
    category: 'cryptocurrency',
    tagSlugs: ['crypto', '5M'],
    cryptoSymbol: 'Bitcoin',
    interval: '5m',
    cryptoCategory: 'up-down',
    marketType: MarketType.CRYPTO_UP_DOWN,
    ...overrides,
  };
}

describe('pickBestAutoTrackMarket', () => {
  const now = Date.parse('2026-06-25T15:12:00.000Z');

  it('prefers the live window over upcoming ones', () => {
    const live = makeItem({
      question: 'Bitcoin Up or Down - June 25, 11:10AM-11:15AM ET',
      startDate: '2026-06-25T15:10:00.000Z',
      endDate: '2026-06-25T15:15:00.000Z',
    });
    const upcoming = makeItem({
      question: 'Bitcoin Up or Down - June 25, 12:00PM-12:05PM ET',
      startDate: '2026-06-25T16:00:00.000Z',
      endDate: '2026-06-25T16:05:00.000Z',
      volume24hr: 999_999,
    });

    expect(isMarketLiveNow(live, now)).toBe(true);
    expect(pickBestAutoTrackMarket([upcoming, live], now)?.conditionId).toBe(
      live.conditionId,
    );
  });

  it('returns null when requireLive is set and only upcoming markets exist', () => {
    const upcoming = makeItem({
      startDate: '2026-06-25T16:00:00.000Z',
      endDate: '2026-06-25T16:05:00.000Z',
    });

    expect(
      pickBestAutoTrackMarket([upcoming], now, { requireLive: true }),
    ).toBeNull();
  });
});

describe('pickBestFutureAutoTrackMarket', () => {
  const now = Date.parse('2026-06-25T15:12:00.000Z');

  it('picks the nearest upcoming window and skips the live selection', () => {
    const live = makeItem({
      conditionId: '0xlive',
      startDate: '2026-06-25T15:10:00.000Z',
      endDate: '2026-06-25T15:15:00.000Z',
    });
    const next = makeItem({
      conditionId: '0xnext',
      startDate: '2026-06-25T15:15:00.000Z',
      endDate: '2026-06-25T15:20:00.000Z',
    });
    const later = makeItem({
      conditionId: '0xlater',
      startDate: '2026-06-25T16:00:00.000Z',
      endDate: '2026-06-25T16:05:00.000Z',
      volume24hr: 999_999,
    });

    expect(
      pickBestFutureAutoTrackMarket([live, later, next], '0xlive', now)?.conditionId,
    ).toBe('0xnext');
  });
});

describe('isGammaMarketValidForAutoTrack', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a live Bitcoin Up/Down market', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-25T15:12:00.000Z'));
    const gamma = {
      question: 'Bitcoin Up or Down - June 25, 11:10AM-11:15AM ET',
      eventStartTime: '2026-06-25T15:10:00.000Z',
      closed: false,
      resolved: false,
      acceptingOrders: true,
      endDate: '2026-06-25T15:15:00.000Z',
    } as any;

    expect(isGammaMarketValidForAutoTrack(gamma, 'Bitcoin')).toBe(true);
    expect(isGammaMarketValidForAutoTrack(gamma, 'Bitcoin', { requireLive: true })).toBe(
      true,
    );
  });

  it('rejects an upcoming window when requireLive is set', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-25T15:12:00.000Z'));
    const gamma = {
      question: 'Bitcoin Up or Down - June 25, 12:00PM-12:05PM ET',
      eventStartTime: '2026-06-25T16:00:00.000Z',
      closed: false,
      resolved: false,
      acceptingOrders: true,
      endDate: '2026-06-25T16:05:00.000Z',
    } as any;

    expect(isGammaMarketValidForAutoTrack(gamma, 'Bitcoin', { requireLive: false })).toBe(
      true,
    );
    expect(isGammaMarketValidForAutoTrack(gamma, 'Bitcoin', { requireLive: true })).toBe(
      false,
    );
  });
});

describe('isGammaMarketLiveNow', () => {
  it('returns false when eventStartTime is in the future', () => {
    const now = Date.parse('2026-06-25T15:12:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const gamma = {
      question: 'Bitcoin Up or Down - June 25, 11:59PM-12:04AM ET',
      eventStartTime: '2026-06-26T03:59:00.000Z',
      closed: false,
      resolved: false,
      acceptingOrders: true,
      endDate: new Date(now + 900_000).toISOString(),
    } as any;

    expect(isGammaMarketLiveNow(gamma)).toBe(false);
  });
});

describe('buildUpDownEventSlug', () => {
  it('builds deterministic slugs for supported assets', async () => {
    const { buildUpDownEventSlug } = await import('./auto-track-discovery.js');
    expect(buildUpDownEventSlug('Bitcoin', '5m', 1_782_443_400)).toBe(
      'btc-updown-5m-1782443400',
    );
    expect(buildUpDownEventSlug('Ethereum', '15m', 1_782_443_400)).toBe(
      'eth-updown-15m-1782443400',
    );
    expect(buildUpDownEventSlug('UnknownCoin', '5m', 123)).toBeNull();
  });
});

describe('discoverBestAutoTrackMarket slug path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses slug lookup for 5m before tag pagination', async () => {
    const { discoverBestAutoTrackMarket } = await import('./auto-track-discovery.js');
    const live = makeItem({
      conditionId: '0xslug',
      startDate: '2026-06-25T15:10:00.000Z',
      endDate: '2026-06-25T15:15:00.000Z',
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/slug/btc-updown-5m-')) {
        return {
          ok: true,
          json: async () => ({
            slug: 'btc-updown-5m-test',
            markets: [
              {
                conditionId: live.conditionId,
                question: live.question,
                slug: live.slug,
                clobTokenIds: '["0x1","0x2"]',
                outcomes: '["Up","Down"]',
                outcomePrices: '["0.5","0.5"]',
                eventStartTime: live.startDate,
                endDate: live.endDate,
                acceptingOrders: true,
                closed: false,
              },
            ],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-25T15:12:00.000Z'));

    const result = await discoverBestAutoTrackMarket('Bitcoin', '5m', {
      requireLive: true,
    });
    expect(result?.conditionId).toBe('0xslug');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/events/slug/'))).toBe(
      true,
    );
  });
});
