import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GammaMarketCache } from './gamma-market-cache.js';

vi.mock('./market-metadata.js', () => ({
  fetchGammaMarket: vi.fn(),
}));

import { fetchGammaMarket } from './market-metadata.js';

describe('GammaMarketCache', () => {
  beforeEach(() => {
    vi.mocked(fetchGammaMarket).mockReset();
  });

  it('fetches once per conditionId and reuses cached value', async () => {
    vi.mocked(fetchGammaMarket).mockResolvedValue({
      question: 'Bitcoin Up or Down',
      closed: false,
      resolved: false,
    } as never);

    const cache = new GammaMarketCache();
    const first = await cache.get('cond-1');
    const second = await cache.get('cond-1');

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fetchGammaMarket).toHaveBeenCalledTimes(1);
    expect(fetchGammaMarket).toHaveBeenCalledWith('cond-1');
  });

  it('propagates fetch errors instead of caching null', async () => {
    vi.mocked(fetchGammaMarket).mockRejectedValue(new Error('network'));

    const cache = new GammaMarketCache();
    await expect(cache.get('cond-2')).rejects.toThrow('network');
    expect(fetchGammaMarket).toHaveBeenCalledTimes(1);
  });

  it('allows manual set without fetching', async () => {
    const cache = new GammaMarketCache();
    cache.set('cond-3', { question: 'manual', closed: false, resolved: false } as never);

    expect(await cache.get('cond-3')).toMatchObject({ question: 'manual' });
    expect(fetchGammaMarket).not.toHaveBeenCalled();
  });
});
