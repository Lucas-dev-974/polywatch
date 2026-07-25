import { describe, expect, it } from 'vitest';
import { buildPolymarketMarketUrl } from './url.js';

describe('buildPolymarketMarketUrl', () => {
  it('prefers the parent event slug', () => {
    const url = buildPolymarketMarketUrl(
      'fifwc-fra-sen-2026-06-16-more-markets',
      'fifwc-fra-sen-2026-06-16-team-total-home-2pt5',
      '0x4a060c12a1d21dd649782746b6e25b50c116af357ba288f366a99ed2eadcb025',
    );
    expect(url).toBe(
      'https://polymarket.com/event/fifwc-fra-sen-2026-06-16-more-markets',
    );
  });

  it('falls back to market slug when no event slug is available', () => {
    const url = buildPolymarketMarketUrl(
      null,
      'standalone-market',
      '0xabc',
    );
    expect(url).toBe('https://polymarket.com/event/standalone-market');
  });

  it('falls back to condition id when no slugs are available', () => {
    const url = buildPolymarketMarketUrl(null, null, '0xabc');
    expect(url).toBe('https://polymarket.com/market/0xabc');
  });
});
