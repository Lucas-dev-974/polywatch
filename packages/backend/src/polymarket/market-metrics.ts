import type { MarketMetricsDto, MarketTradeDto } from '@polywatch/core';
import { fetchGammaMarket, fetchPriceHistory, DEFAULT_PRICE_HISTORY_FIDELITY } from '@polywatch/core';
import { config } from '../config.js';

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { data: MarketMetricsDto; expiresAt: number }>();

function parseConditionId(conditionId: string): string {
  return conditionId.toLowerCase();
}

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

/** Map Polymarket crypto symbol labels to CoinGecko coin ids. */
const CRYPTO_SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  Bitcoin: 'bitcoin',
  Ethereum: 'ethereum',
  Solana: 'solana',
  XRP: 'ripple',
  Dogecoin: 'dogecoin',
  Cardano: 'cardano',
  Chainlink: 'chainlink',
  Polygon: 'matic-network',
  Litecoin: 'litecoin',
  Polkadot: 'polkadot',
  Avalanche: 'avalanche-2',
  Uniswap: 'uniswap',
  'Shiba Inu': 'shiba-inu',
};

/** Best-effort mapping from market interval to CoinGecko `days`. */
function intervalToDays(interval: string | undefined | null): number {
  if (!interval) return 1;
  switch (interval) {
    case '5m':
    case '15m':
      return 1;
    case '1h':
      return 1;
    case '4h':
      return 3;
    case '1d':
      return 7;
    case '1w':
      return 30;
    case '1mo':
      return 90;
    case '1y':
      return 365;
    default:
      return 1;
  }
}

async function fetchCryptoSpotHistory(
  cryptoSymbol: string,
  interval: string | null,
): Promise<{ t: number; p: number }[]> {
  const coinId = CRYPTO_SYMBOL_TO_COINGECKO_ID[cryptoSymbol];
  if (!coinId) return [];

  const days = intervalToDays(interval);
  const params = new URLSearchParams({
    vs_currency: 'usd',
    days: String(days),
  });

  try {
    const res = await fetch(
      `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart?${params}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { prices?: [number, number][] };
    if (!Array.isArray(data.prices)) return [];
    return data.prices.map(([t, p]) => ({ t, p }));
  } catch (err) {
    console.warn('[crypto-spot-history] failed', { coinId, interval }, err);
    return [];
  }
}

async function fetchOpenInterest(conditionId: string): Promise<number | undefined> {
  const params = new URLSearchParams({ market: conditionId });
  const res = await fetch(`${config.dataApi}/oi?${params}`);
  if (!res.ok) return undefined;
  const rows = (await res.json()) as { market: string; value: number }[];
  if (!Array.isArray(rows)) return undefined;
  const match = rows.find(
    (r) => r.market?.toLowerCase() === parseConditionId(conditionId),
  );
  return match?.value;
}

async function fetchPriceHistoryFromClob(
  assetId: string,
): Promise<{ t: number; p: number }[]> {
  return fetchPriceHistory({ assetId, fidelity: DEFAULT_PRICE_HISTORY_FIDELITY });
}

async function fetchRecentTrades(conditionId: string): Promise<MarketTradeDto[]> {
  const params = new URLSearchParams({
    market: conditionId,
    limit: '50',
  });
  const res = await fetch(`${config.dataApi}/trades?${params}`);
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    timestamp?: number | string;
    price?: number | string;
    size?: number | string;
    side?: string;
  }>;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      timestamp: Number(row.timestamp ?? 0),
      price: Number(row.price ?? 0),
      size: Number(row.size ?? 0),
      side: typeof row.side === 'string' ? row.side : undefined,
    }))
    .filter((row) => row.timestamp > 0 && row.price > 0)
    .slice(0, 100);
}

export async function resolveMarketMetrics(
  conditionId: string,
  options: {
    assetId?: string;
    includeHistory?: boolean;
    cryptoSymbol?: string;
    interval?: string | null;
  } = {},
): Promise<MarketMetricsDto | null> {
  const cacheKey = `${conditionId}:${options.includeHistory ? 'full' : 'base'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const gamma = await fetchGammaMarket(conditionId);
  if (!gamma) return null;

  const cryptoSymbol = options.cryptoSymbol;
  const [openInterest, priceHistory, recentTrades, cryptoSpotHistory] = await Promise.all([
    fetchOpenInterest(conditionId),
    options.includeHistory && options.assetId
      ? fetchPriceHistoryFromClob(options.assetId)
      : Promise.resolve([]),
    options.includeHistory
      ? fetchRecentTrades(conditionId)
      : Promise.resolve([]),
    options.includeHistory && cryptoSymbol
      ? fetchCryptoSpotHistory(cryptoSymbol, options.interval ?? null)
      : Promise.resolve([]),
  ]);

  const dto: MarketMetricsDto = {
    conditionId,
    volume: gamma.volume,
    volume24hr: gamma.volume24hr,
    liquidityClob: gamma.liquidityClob,
    outcomePrices: gamma.outcomePricesParsed,
    openInterest,
    description: gamma.description,
    icon: gamma.icon,
    fetchedAt: new Date().toISOString(),
    ...(options.includeHistory
      ? {
          priceHistory: priceHistory.length > 0 ? priceHistory : undefined,
          recentTrades: recentTrades.length > 0 ? recentTrades : undefined,
          cryptoSpotHistory:
            cryptoSpotHistory.length > 0 ? cryptoSpotHistory : undefined,
        }
      : {}),
  };

  cache.set(cacheKey, { data: dto, expiresAt: Date.now() + CACHE_TTL_MS });
  return dto;
}
