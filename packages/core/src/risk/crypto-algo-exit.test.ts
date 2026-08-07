import { describe, expect, it } from 'vitest';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  CRYPTO_MIN_TIME_TO_CLOSE_BUFFER_SECONDS,
  normalizeCryptoInterval,
  parseIntervalFromMarketSlug,
  resolveAlgoEntryExitParams,
  resolveCryptoAlgoMinTimeToClose,
  resolveCryptoAlgoPreCloseSeconds,
  resolveExitDecisionMarkPrice,
  resolveLiveCloseableBid,
  resolveMarketInterval,
} from './crypto-algo-exit.js';

function makeExitRisk(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoSlEnabled: true,
    cryptoAlgoTpEnabled: true,
    cryptoAlgoTrailingEnabled: true,
    cryptoAlgoTrailingBidPoints: null,
    cryptoAlgoTrailingActivationBidPoints: null,
    cryptoAlgoSlBidPoints: null,
    cryptoAlgoTpBidPoints: null,
    ...overrides,
  } as CryptoConfig;
}

function makeRisk(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoPreCloseEnabled: true,
    cryptoAlgoPreCloseSeconds: null,
    cryptoAlgoMinTimeToClose: null,
    ...overrides,
  } as CryptoConfig;
}

describe('resolveCryptoAlgoPreCloseSeconds', () => {
  it('uses interval table when no explicit override', () => {
    expect(resolveCryptoAlgoPreCloseSeconds(makeRisk(), '5m')).toBe(120);
    expect(resolveCryptoAlgoPreCloseSeconds(makeRisk(), '1h')).toBe(300);
  });

  it('respects explicit override', () => {
    expect(
      resolveCryptoAlgoPreCloseSeconds(
        makeRisk({ cryptoAlgoPreCloseSeconds: 90 }),
        '5m',
      ),
    ).toBe(90);
  });

  it('keeps interval window when sells are disabled (null ≡ false)', () => {
    expect(
      resolveCryptoAlgoPreCloseSeconds(
        makeRisk({ cryptoAlgoPreCloseEnabled: false }),
        '5m',
      ),
    ).toBe(120);
    expect(
      resolveCryptoAlgoPreCloseSeconds(
        makeRisk({ cryptoAlgoPreCloseEnabled: null }),
        '5m',
      ),
    ).toBe(120);
  });
});

describe('resolveCryptoAlgoMinTimeToClose', () => {
  it('derives from pre-close + buffer', () => {
    expect(resolveCryptoAlgoMinTimeToClose(makeRisk(), '5m')).toBe(
      120 + CRYPTO_MIN_TIME_TO_CLOSE_BUFFER_SECONDS,
    );
  });

  it('keeps entry buffer when pre-close sells are disabled', () => {
    expect(
      resolveCryptoAlgoMinTimeToClose(
        makeRisk({ cryptoAlgoPreCloseEnabled: false }),
        '5m',
      ),
    ).toBe(120 + CRYPTO_MIN_TIME_TO_CLOSE_BUFFER_SECONDS);
  });

  it('uses explicit override when set', () => {
    expect(
      resolveCryptoAlgoMinTimeToClose(
        makeRisk({ cryptoAlgoMinTimeToClose: 200 }),
        '5m',
      ),
    ).toBe(200);
  });
});

describe('parseIntervalFromMarketSlug', () => {
  it('parses up/down slug', () => {
    expect(parseIntervalFromMarketSlug('btc-updown-5m-1782554100')).toBe('5m');
  });
});

describe('resolveMarketInterval', () => {
  it('falls back to slug when signal interval is empty', () => {
    expect(
      resolveMarketInterval(
        { slug: 'btc-updown-5m-1782554100', eventSlug: null },
        '',
      ),
    ).toBe('5m');
  });
});

describe('resolveAlgoEntryExitParams', () => {
  it('uses interval defaults when overrides are null', () => {
    expect(resolveAlgoEntryExitParams(makeExitRisk(), '5m')).toEqual({
      trailingBidPoints: 0.05,
      trailingActivationBidPoints: 0.06,
      slBidPoints: 0.10,
      tpBidPoints: 0.12,
    });
  });

  it('respects explicit override', () => {
    expect(
      resolveAlgoEntryExitParams(
        makeExitRisk({ cryptoAlgoSlBidPoints: 0.20 }), '5m',
      ).slBidPoints,
    ).toBe(0.20);
  });

  it('treats zero override as disabled', () => {
    expect(
      resolveAlgoEntryExitParams(
        makeExitRisk({ cryptoAlgoSlBidPoints: 0, cryptoAlgoTpBidPoints: 0 }),
        '5m',
      ),
    ).toEqual({
      trailingBidPoints: 0.05,
      trailingActivationBidPoints: 0.06,
      slBidPoints: null,
      tpBidPoints: null,
    });
  });

  it('treats zero bid-points override as disabled (null)', () => {
    const params = resolveAlgoEntryExitParams(
      makeExitRisk({ cryptoAlgoSlBidPoints: 0, cryptoAlgoTpBidPoints: 0 }),
      '5m',
    );
    expect(params.slBidPoints).toBeNull();
    expect(params.tpBidPoints).toBeNull();
  });

  it('treats negative bid-points override as disabled (null)', () => {
    const params = resolveAlgoEntryExitParams(
      makeExitRisk({ cryptoAlgoSlBidPoints: -0.05, cryptoAlgoTpBidPoints: -0.05 }),
      '5m',
    );
    expect(params.slBidPoints).toBeNull();
    expect(params.tpBidPoints).toBeNull();
  });

  it('respects explicit positive bid-points override', () => {
    const params = resolveAlgoEntryExitParams(
      makeExitRisk({ cryptoAlgoSlBidPoints: 0.20, cryptoAlgoTpBidPoints: 0.25 }),
      '5m',
    );
    expect(params.slBidPoints).toBe(0.20);
    expect(params.tpBidPoints).toBe(0.25);
  });

  it('returns null bid points on non-binary market (binary guard)', () => {
    const params = resolveAlgoEntryExitParams(
      makeExitRisk({ cryptoAlgoSlBidPoints: 0.20, cryptoAlgoTpBidPoints: 0.25 }),
      null,
    );
    expect(params.slBidPoints).toBeNull();
    expect(params.tpBidPoints).toBeNull();
  });

  it('uses interval defaults when algo exit legs are enabled', () => {
    expect(
      resolveAlgoEntryExitParams(makeExitRisk(), '5m').slBidPoints,
    ).toBe(0.10);
  });

  it('disables each algo exit leg independently via enable flags', () => {
    expect(
      resolveAlgoEntryExitParams(
        makeExitRisk({ cryptoAlgoSlEnabled: false }), '5m',
      ),
    ).toMatchObject({ slBidPoints: null, tpBidPoints: 0.12 });
    expect(
      resolveAlgoEntryExitParams(
        makeExitRisk({ cryptoAlgoTpEnabled: false }), '5m',
      ),
    ).toMatchObject({ slBidPoints: 0.10, tpBidPoints: null });
    expect(
      resolveAlgoEntryExitParams(
        makeExitRisk({ cryptoAlgoTrailingEnabled: false }), '5m',
      ).trailingBidPoints,
    ).toBeNull();
  });

  it('disables algo legs when enable flags are missing (fail-closed)', () => {
    expect(
      resolveAlgoEntryExitParams(
        makeExitRisk({
          cryptoAlgoSlEnabled: undefined,
          cryptoAlgoTpEnabled: undefined,
          cryptoAlgoTrailingEnabled: undefined,
        }),
        '5m',
      ),
    ).toEqual({
      trailingBidPoints: null,
      trailingActivationBidPoints: null,
      slBidPoints: null,
      tpBidPoints: null,
    });
  });

  it('returns null trailing when interval is unknown (no mode fallback)', () => {
    expect(
      resolveAlgoEntryExitParams(makeExitRisk(), null),
    ).toEqual({
      trailingBidPoints: null,
      trailingActivationBidPoints: null,
      slBidPoints: null,
      tpBidPoints: null,
    });
  });
});

describe('normalizeCryptoInterval', () => {
  it('normalizes aliases', () => {
    expect(normalizeCryptoInterval('5min')).toBe('5m');
  });
});

describe('resolveExitDecisionMarkPrice', () => {
  const pos = {
    assetId: 'token-no',
    executableBidVwap: 0,
    entryBidVwap: 0.55,
    entryPrice: 0.57,
    lastCloseableBidVwap: 0.52,
    lastCloseableBidAt: new Date(),
  };

  it('uses last closeable bid when illiquid instead of entry fallback', () => {
    const mark = resolveExitDecisionMarkPrice(
      pos,
      0,
      null,
      'illiquid',
      undefined,
    );
    expect(mark).toBe(0.52);
  });

  it('respects lastCloseableBidMaxAgeMs override from CryptoConfig', () => {
    const staleAt = new Date(Date.now() - 45_000);
    const stalePos = { ...pos, lastCloseableBidAt: staleAt };
    // Default 60s → still fresh
    expect(
      resolveExitDecisionMarkPrice(stalePos, 0, null, 'illiquid', undefined),
    ).toBe(0.52);
    // Tunable 30s → stale, falls through (no other candidates → entry mark)
    const mark = resolveExitDecisionMarkPrice(
      stalePos,
      0,
      null,
      'illiquid',
      undefined,
      Date.now(),
      undefined,
      undefined,
      undefined,
      30_000,
    );
    expect(mark).not.toBe(0.52);
  });

  it('prefers ws best bid when illiquid', () => {
    expect(
      resolveExitDecisionMarkPrice(pos, 0, null, 'illiquid', 0.48),
    ).toBe(0.48);
  });

  it('uses last trade price in illiquid market when it signals a worse loss than stale bid', () => {
    expect(
      resolveExitDecisionMarkPrice(pos, 0, null, 'illiquid', 0.55, Date.now(), 0.32, undefined, new Date()),
    ).toBe(0.32);
  });

  it('ignores stale last trade price above bid in illiquid market', () => {
    expect(
      resolveExitDecisionMarkPrice(pos, 0, null, 'illiquid', 0.48, Date.now(), 0.60, undefined, new Date()),
    ).toBe(0.48);
  });

  it('uses conservative min when illiquid book bid masks a lower last trade', () => {
    expect(
      resolveExitDecisionMarkPrice(
        pos,
        0.65,
        null,
        'illiquid',
        undefined,
        Date.now(),
        0.48,
        undefined,
        new Date(),
      ),
    ).toBe(0.48);
  });

  it('ignores stale last trade price when timestamp is too old', () => {
    const staleTimestamp = new Date(Date.now() - 300_000); // 5 min old
    expect(
      resolveExitDecisionMarkPrice(pos, 0.65, null, 'illiquid', undefined, Date.now(), 0.32, undefined, staleTimestamp),
    ).toBe(0.52);
  });

  it('includes last trade price when no timestamp is provided (backward compat)', () => {
    expect(
      resolveExitDecisionMarkPrice(pos, 0.65, null, 'illiquid', undefined, Date.now(), 0.32),
    ).toBe(0.32);
  });

  it('ignores last trade price with a future timestamp (clock skew guard)', () => {
    const futureTimestamp = new Date(Date.now() + 600_000);
    expect(
      resolveExitDecisionMarkPrice(pos, 0.65, null, 'illiquid', undefined, Date.now(), 0.32, undefined, futureTimestamp),
    ).toBe(0.52);
  });

  it('filters anomalously low wsBestBid when bookBid is reliable', () => {
    expect(
      resolveExitDecisionMarkPrice(
        { ...pos, lastCloseableBidVwap: 0, lastCloseableBidAt: null },
        0.36,
        null,
        'ok',
        0.01,
        Date.now(),
        undefined,
        { conservative: true },
      ),
    ).toBe(0.36);
  });

  it('includes wsBestBid when it is close to bookBid (not anomalous)', () => {
    expect(
      resolveExitDecisionMarkPrice(
        { ...pos, lastCloseableBidVwap: 0, lastCloseableBidAt: null },
        0.36,
        null,
        'ok',
        0.34,
        Date.now(),
        undefined,
        { conservative: true },
      ),
    ).toBe(0.34);
  });

  it('includes wsBestBid when bookBid is 0 (no reference to compare)', () => {
    expect(
      resolveExitDecisionMarkPrice(
        { ...pos, lastCloseableBidVwap: 0, lastCloseableBidAt: null },
        0,
        null,
        'ok',
        0.01,
        Date.now(),
        undefined,
        { conservative: true },
      ),
    ).toBe(0.01);
  });
});

describe('resolveLiveCloseableBid', () => {
  it('prefers executable vwap', () => {
    expect(resolveLiveCloseableBid(0.6, 0.5)).toBe(0.6);
  });

  it('falls back to ws', () => {
    expect(resolveLiveCloseableBid(0, 0.44)).toBe(0.44);
  });

  it('falls back to sized best bid when ws absent', () => {
    expect(resolveLiveCloseableBid(0, undefined, 0.22)).toBe(0.22);
  });
});
