import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTraderPositions } from './api-client.js';

const TRADER = '0xtrader';

// Mock config so the test doesn't depend on env
vi.mock('../config.js', () => ({
  config: { dataApi: 'https://data-api.test.com' },
}));

function mockPage(positions: any[], length: number) {
  // Returns enough items to fill `length`, then truncates to simulate the API response
  const items = positions.slice(0, length);
  return { json: () => Promise.resolve(items), ok: true };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchTraderPositions', () => {
  it('fetches all pages when total exceeds LIMIT', async () => {
    // Generate 1200 positions — should take 3 pages (500 + 500 + 200)
    const allPositions = Array.from({ length: 1200 }, (_, i) => ({
      conditionId: `c${i}`,
      asset: `a${i}`,
      size: (i + 1) * 10,
    }));

    (globalThis.fetch as any).mockImplementation(async (url: string) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 500);
      const page = allPositions.slice(offset, offset + limit);
      return mockPage(page, page.length);
    });

    const { positions: result, truncated } = await fetchTraderPositions(TRADER);

    expect(result).toHaveLength(1200);
    expect(result[0].conditionId).toBe('c0');
    expect(result[1199].conditionId).toBe('c1199');
    expect(truncated).toBe(false);
  });

  it('stops early when a page returns fewer items than LIMIT', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      conditionId: `c${i}`, asset: `a${i}`, size: 1,
    }));
    const page2 = Array.from({ length: 200 }, (_, i) => ({
      conditionId: `c${500 + i}`, asset: `a${500 + i}`, size: 1,
    }));

    let callCount = 0;
    (globalThis.fetch as any).mockImplementation(async () => {
      callCount++;
      const items = callCount === 1 ? page1 : page2;
      return mockPage(items, items.length);
    });

    const { positions: result } = await fetchTraderPositions(TRADER);

    expect(result).toHaveLength(700);
    expect(callCount).toBe(2);
  });

  it('throws on non-ok response', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchTraderPositions(TRADER)).rejects.toThrow('Data API error: 500');
  });

  it('maps response fields correctly', async () => {
    const apiResponse = [
      { conditionId: 'c1', asset: 'a1', size: '100', avgPrice: '0.5', outcome: 'Yes' },
    ];
    (globalThis.fetch as any).mockResolvedValue(mockPage(apiResponse, 1));

    const { positions: result } = await fetchTraderPositions(TRADER);

    expect(result).toEqual([
      { conditionId: 'c1', assetId: 'a1', size: 100, avgPrice: 0.5, outcome: 'Yes' },
    ]);
  });

  it('preserves a legitimate avgPrice of 0 (no truthy coercion)', async () => {
    const apiResponse = [
      { conditionId: 'c1', asset: 'a1', size: '100', avgPrice: 0, outcome: 'Yes' },
      { conditionId: 'c2', asset: 'a2', size: '50', avgPrice: '0', outcome: 'No' },
    ];
    (globalThis.fetch as any).mockResolvedValue(mockPage(apiResponse, 2));

    const { positions: result } = await fetchTraderPositions(TRADER);

    expect(result[0].avgPrice).toBe(0);
    expect(result[1].avgPrice).toBe(0);
  });

  it('maps absent or non-numeric avgPrice to undefined', async () => {
    const apiResponse = [
      { conditionId: 'c1', asset: 'a1', size: '100', outcome: 'Yes' },
      { conditionId: 'c2', asset: 'a2', size: '50', avgPrice: null, outcome: 'No' },
      { conditionId: 'c3', asset: 'a3', size: '25', avgPrice: 'abc', outcome: 'Yes' },
    ];
    (globalThis.fetch as any).mockResolvedValue(mockPage(apiResponse, 3));

    const { positions: result } = await fetchTraderPositions(TRADER);

    expect(result[0].avgPrice).toBeUndefined();
    expect(result[1].avgPrice).toBeUndefined();
    expect(result[2].avgPrice).toBeUndefined();
  });
});