import { describe, it, expect } from 'vitest';
import { NaiveMomentumStrategy, resolveEntryCandidateFromBand } from './naive-momentum.strategy.js';
import type { MarketListItemDto } from '@polywatch/core';
import { MarketType } from '@polywatch/core';
import type { StrategyContext, TopOfBookData, MidHistorySample } from '../strategy.js';

function makeMarket(overrides: Partial<MarketListItemDto> = {}): MarketListItemDto {
  return {
    conditionId: '0x123',
    question: 'Will Bitcoin go up?',
    slug: 'bitcoin-up',
    eventSlug: 'bitcoin-event',
    icon: null,
    startDate: null,
    endDate: null,
    volume: null,
    volume24hr: null,
    liquidityClob: null,
    outcomePrices: [],
    outcomes: [],
    acceptingOrders: true,
    closed: false,
    url: 'https://polymarket.com/event/bitcoin-event',
    tokenIdYes: '0xyes',
    tokenIdNo: '0xno',
    category: 'crypto',
    tagSlugs: [],
    cryptoSymbol: 'Bitcoin',
    interval: '5min',
    cryptoCategory: 'up-down',
    marketType: MarketType.CRYPTO_UP_DOWN,
    ...overrides,
  };
}

function makeBook(
  overrides: Partial<TopOfBookData> & Pick<TopOfBookData, 'assetId' | 'bid' | 'ask'>,
): TopOfBookData {
  const bid = overrides.bid;
  const ask = overrides.ask;
  const bilateral =
    bid != null && ask != null && bid > 0 && ask > 0 && bid <= ask;
  const spread = bilateral ? ask! - bid! : null;
  return {
    assetId: overrides.assetId,
    bid,
    ask,
    bidSize: overrides.bidSize ?? (bid != null ? 100 : null),
    askSize: overrides.askSize ?? (ask != null ? 100 : null),
    spread: overrides.spread ?? spread,
    midPrice:
      overrides.midPrice ??
      (bilateral ? (bid! + ask!) / 2 : null),
    spreadPercent:
      overrides.spreadPercent ??
      (bilateral && ask! > 0 ? ((ask! - bid!) / ask!) * 100 : null),
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

function ctxWithBooks(
  up: TopOfBookData | null,
  down: TopOfBookData | null,
  now = new Date(),
  midHistory?: StrategyContext['midHistory'],
): StrategyContext {
  return {
    now,
    books: { up, down },
    midHistory,
    secondsUntilEnd: null,
    spotData: null,
  };
}

function makeMidHistory(
  side: 'up' | 'down',
  startMid: number,
  endMid: number,
  spanMs: number,
  points: number,
  nowMs: number,
): StrategyContext['midHistory'] {
  const series: MidHistorySample[] = [];
  for (let i = 0; i < points; i++) {
    const t =
      points === 1
        ? nowMs
        : nowMs - spanMs + (spanMs * i) / (points - 1);
    const mid =
      points === 1
        ? endMid
        : startMid + ((endMid - startMid) * i) / (points - 1);
    series.push({ t, mid });
  }
  return side === 'up' ? { up: series, down: [] } : { up: [], down: series };
}

describe('resolveEntryCandidateFromBand', () => {
  it('returns YES when up price is within band', () => {
    expect(resolveEntryCandidateFromBand(0.65, 0.5, 0.8)).toBe('YES');
  });

  it('returns NO when down price is within band', () => {
    expect(resolveEntryCandidateFromBand(0.35, 0.5, 0.8)).toBe('NO');
  });

  it('returns null on exact boundaries', () => {
    expect(resolveEntryCandidateFromBand(0.5, 0.5, 0.8)).toBeNull();
    expect(resolveEntryCandidateFromBand(0.8, 0.5, 0.8)).toBeNull();
  });
});

describe('NaiveMomentumStrategy', () => {
  const strategy = new NaiveMomentumStrategy();

  it('abstains when outcomePrices is empty', async () => {
    const market = makeMarket({ outcomePrices: [] });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result).toEqual({ kind: 'abstain', reason: 'no_outcome_prices' });
  });

  it('abstains when outcomePrices is missing', async () => {
    const market = makeMarket({ outcomePrices: undefined as unknown as [] });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result).toEqual({ kind: 'abstain', reason: 'no_outcome_prices' });
  });

  it('returns BUY YES signal when YES price > 0.55', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.647,
          ask: 0.653,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.347,
          ask: 0.353,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );

    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('YES');
    expect(result.signal.side).toBe('BUY');
    expect(result.signal.assetId).toBe('0xyes');
    expect(result.signal.strategyId).toBe('naive-momentum');
    expect(result.signal.confidence).toBeCloseTo(0.3);
  });

  it('returns BUY NO signal when YES price < 0.45', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.35 },
        { outcome: 'No', price: 0.65 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.347,
          ask: 0.353,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.647,
          ask: 0.653,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );

    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('NO');
    expect(result.signal.assetId).toBe('0xno');
    expect(result.signal.confidence).toBeCloseTo(0.3);
  });

  it('abstains illiquid_book when target book is missing', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('illiquid_book');
  });

  it('abstains illiquid_book when NO target Down book is unilateral', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.35 },
        { outcome: 'No', price: 0.65 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.34,
          ask: 0.36,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: null,
          ask: 0.66,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('illiquid_book');
  });

  it('abstains when YES price is exactly 0.50 (band boundary)', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.5 },
        { outcome: 'No', price: 0.5 },
      ],
    });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('price_band');
  });

  it('abstains price_band at exclusive entryPriceMin 0.55', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.55 },
        { outcome: 'No', price: 0.45 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.547,
          ask: 0.553,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.447,
          ask: 0.453,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('price_band');
  });

  it('returns YES signal at 0.60 when books are liquid', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.6 },
        { outcome: 'No', price: 0.4 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.597,
          ask: 0.603,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.397,
          ask: 0.403,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('YES');
  });

  it('returns missing_token when tokenIdYes is missing for BUY YES', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.7 },
        { outcome: 'No', price: 0.3 },
      ],
      tokenIdYes: null,
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.69,
          ask: 0.71,
          updatedAt: now.getTime(),
        }),
        null,
        now,
      ),
    );
    expect(result).toEqual({ kind: 'abstain', reason: 'missing_token' });
  });

  it('recognizes Up/Down outcomes as YES/NO', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Up', price: 0.7 },
        { outcome: 'Down', price: 0.3 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.69,
          ask: 0.71,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.29,
          ask: 0.31,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('YES');
  });

  it('rejects when outcomes cannot be identified', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Maybe', price: 0.33 },
        { outcome: 'Uncertain', price: 0.33 },
        { outcome: 'Other', price: 0.34 },
      ],
    });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result).toEqual({ kind: 'abstain', reason: 'unknown_outcomes' });
  });

  it('accepts custom binary labels via index fallback (France/Spain)', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'France', price: 0.65 },
        { outcome: 'Spain', price: 0.35 },
      ],
      tokenIdYes: '0xfr',
      tokenIdNo: '0xes',
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xfr',
          bid: 0.64,
          ask: 0.66,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xes',
          bid: 0.34,
          ask: 0.36,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('YES');
  });

  it('rejects when outcomes sum invalid on Gamma path', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.75 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('invalid_price_sum');
  });

  it('uses WebSocket mid when fresh and bilateral even if Gamma diverges', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.5 },
        { outcome: 'No', price: 0.5 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.29,
          ask: 0.31,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.69,
          ask: 0.71,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );

    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('NO');
    expect(result.signal.reasons).toContain('price source: websocket');
  });

  it('falls back to Gamma for NO when Up is stale but Down target is fresh', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.35 },
        { outcome: 'No', price: 0.65 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.29,
          ask: 0.31,
          updatedAt: now.getTime() - 20_000,
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.64,
          ask: 0.66,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );

    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('NO');
    expect(result.signal.reasons).toContain('price source: gamma');
  });

  it('abstains stale_book when YES target Up book is stale', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.7 },
        { outcome: 'No', price: 0.3 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.69,
          ask: 0.71,
          updatedAt: now.getTime() - 20_000,
        }),
        null,
        now,
      ),
    );

    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('stale_book');
  });

  it('emits NO when Up is weak but Down book is liquid (spread gate on target token)', async () => {
    const market = makeMarket({
      interval: '5m',
      outcomePrices: [
        { outcome: 'Up', price: 0.25 },
        { outcome: 'Down', price: 0.75 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.24,
          ask: 0.26,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.745,
          ask: 0.755,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );

    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('NO');
  });

  it('blocks YES when Up absolute spread exceeds 5m max', async () => {
    const market = makeMarket({
      interval: '5m',
      outcomePrices: [
        { outcome: 'Yes', price: 0.7 },
        { outcome: 'No', price: 0.3 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.64,
          ask: 0.76, // spreadAbs 0.12 > 0.05
          updatedAt: now.getTime(),
        }),
        null,
        now,
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('spread_gate');
  });

  it('blocks NO when Down absolute spread exceeds max (target token)', async () => {
    const market = makeMarket({
      interval: '5m',
      outcomePrices: [
        { outcome: 'Yes', price: 0.35 },
        { outcome: 'No', price: 0.65 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.34,
          ask: 0.36,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.58,
          ask: 0.72, // spreadAbs 0.14 > 0.05
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('spread_gate');
  });

  it('allows absolute spread 0.04 on 5m (passes gate that relative % would fail on cheap tokens)', async () => {
    const market = makeMarket({
      interval: '5m',
      outcomePrices: [
        { outcome: 'Yes', price: 0.7 },
        { outcome: 'No', price: 0.3 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.68,
          ask: 0.72, // 0.04 abs
          updatedAt: now.getTime(),
        }),
        null,
        now,
      ),
    );
    expect(result.kind).toBe('signal');
  });

  it('does not block WS path when Gamma sum is invalid', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.75 },
        { outcome: 'No', price: 0.35 }, // invalid sum, but WS is source
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.29,
          ask: 0.31,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.69,
          ask: 0.71,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('NO');
    expect(result.signal.reasons).toContain('price source: websocket');
  });

  it('rejects invalid interval format', async () => {
    const market = makeMarket({
      interval: 'invalid',
      outcomePrices: [
        { outcome: 'Yes', price: 0.7 },
        { outcome: 'No', price: 0.3 },
      ],
    });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result).toEqual({
      kind: 'abstain',
      reason: 'invalid_interval',
      detail: 'invalid',
    });
  });

  it('XRP-like first minute: Gamma stale 0.5, WS Up ~0.32 → NO signal', async () => {
    const market = makeMarket({
      interval: '5m',
      outcomePrices: [
        { outcome: 'Up', price: 0.5 },
        { outcome: 'Down', price: 0.5 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.32,
          ask: 0.33,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.67,
          ask: 0.68,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('NO');
  });

  it('uses threshold override from setConfig when entry band is disabled', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ baseThreshold: 0.6, entryPriceBandEnabled: false });
    const now = new Date();
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Up', price: 0.58 },
        { outcome: 'Down', price: 0.42 },
      ],
    });
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.57,
          ask: 0.59,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.41,
          ask: 0.43,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result).toEqual({ kind: 'abstain', reason: 'neutral_zone' });
  });

  it('abstains price_band when YES price is above max', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.85 },
        { outcome: 'No', price: 0.15 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.847,
          ask: 0.853,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.147,
          ask: 0.153,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('price_band');
  });

  it('abstains price_band when Down price is above max', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.15 },
        { outcome: 'No', price: 0.85 },
      ],
    });
    const result = await strategy.evaluate(market, ctxWithBooks(null, null));
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('price_band');
  });

  it('abstains price_band for yesPrice 0.52 under stop-bleed min 0.55', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.52 },
        { outcome: 'No', price: 0.48 },
      ],
    });
    const now = new Date();
    const result = await strategy.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.517,
          ask: 0.523,
          updatedAt: now.getTime(),
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.477,
          ask: 0.483,
          updatedAt: now.getTime(),
        }),
        now,
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('price_band');
  });

  it('abstains curve_descending when YES target Up mid is descending', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ curveFilterEnabled: true, curveLookbackMs: 10_000, curveMinDelta: 0.01 });
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const now = new Date();
    const nowMs = now.getTime();
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.647,
          ask: 0.653,
          updatedAt: nowMs,
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.347,
          ask: 0.353,
          updatedAt: nowMs,
        }),
        now,
        makeMidHistory('up', 0.67, 0.65, 10_000, 5, nowMs),
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('curve_descending');
  });

  it('allows YES when Up flat despite Down descending history', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ curveFilterEnabled: true, curveLookbackMs: 10_000, curveMinDelta: 0.01 });
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const now = new Date();
    const nowMs = now.getTime();
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.647,
          ask: 0.653,
          updatedAt: nowMs,
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.347,
          ask: 0.353,
          updatedAt: nowMs,
        }),
        now,
        {
          up: makeMidHistory('up', 0.65, 0.652, 10_000, 5, nowMs)!.up,
          down: makeMidHistory('down', 0.38, 0.35, 10_000, 5, nowMs)!.down,
        },
      ),
    );
    expect(result.kind).toBe('signal');
    if (result.kind !== 'signal') return;
    expect(result.signal.outcome).toBe('YES');
  });

  it('abstains curve_descending for NO when Down mid is descending', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ curveFilterEnabled: true, curveLookbackMs: 10_000, curveMinDelta: 0.01 });
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.35 },
        { outcome: 'No', price: 0.65 },
      ],
    });
    const now = new Date();
    const nowMs = now.getTime();
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.347,
          ask: 0.353,
          updatedAt: nowMs,
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.647,
          ask: 0.653,
          updatedAt: nowMs,
        }),
        now,
        makeMidHistory('down', 0.67, 0.65, 10_000, 5, nowMs),
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('curve_descending');
  });

  it('ignores curve gate when disabled', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ curveFilterEnabled: false });
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const now = new Date();
    const nowMs = now.getTime();
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.647,
          ask: 0.653,
          updatedAt: nowMs,
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.347,
          ask: 0.353,
          updatedAt: nowMs,
        }),
        now,
        makeMidHistory('up', 0.67, 0.65, 10_000, 5, nowMs),
      ),
    );
    expect(result.kind).toBe('signal');
  });

  it('abstains curve_insufficient when history too sparse (fail-closed)', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ curveFilterEnabled: true, curveLookbackMs: 10_000, curveMinDelta: 0.01 });
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const now = new Date();
    const nowMs = now.getTime();
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        makeBook({
          assetId: '0xyes',
          bid: 0.647,
          ask: 0.653,
          updatedAt: nowMs,
        }),
        makeBook({
          assetId: '0xno',
          bid: 0.347,
          ask: 0.353,
          updatedAt: nowMs,
        }),
        now,
        makeMidHistory('up', 0.65, 0.65, 1_000, 2, nowMs),
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('curve_insufficient');
  });

  it('abstains illiquid_book before curve_descending when YES target book missing', async () => {
    const custom = new NaiveMomentumStrategy();
    custom.setConfig({ curveFilterEnabled: true, curveLookbackMs: 10_000, curveMinDelta: 0.01 });
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const now = new Date();
    const nowMs = now.getTime();
    const result = await custom.evaluate(
      market,
      ctxWithBooks(
        null,
        makeBook({
          assetId: '0xno',
          bid: 0.347,
          ask: 0.353,
          updatedAt: nowMs,
        }),
        now,
        makeMidHistory('up', 0.67, 0.65, 10_000, 5, nowMs),
      ),
    );
    expect(result.kind).toBe('abstain');
    if (result.kind !== 'abstain') return;
    expect(result.reason).toBe('illiquid_book');
  });
});
