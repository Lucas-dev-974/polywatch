import { config } from '../config.js';
import { normalizeOutcome, type PositionSnapshot } from '@polywatch/core';
import { DATA_API_PAGE_LIMIT, DATA_API_MAX_PAGES } from '../constants.js';
import { rateLimitedFetch } from './rate-limited-fetch.js';
import {
  dataApiGeneralBucket,
  dataApiPositionsBucket,
} from './token-bucket.js';

export interface DataApiPosition {
  conditionId: string;
  asset: string;
  size: number;
  avgPrice?: number;
  outcome?: string;
}

export async function fetchTraderPortfolioValue(
  traderAddress: string,
): Promise<number> {
  const url = `${config.dataApi}/value?user=${traderAddress}`;
  const res = await rateLimitedFetch(url, dataApiGeneralBucket);
  if (!res.ok) throw new Error(`Data API value error: ${res.status}`);
  const data = (await res.json()) as { user: string; value: number }[];
  const row = data.find(
    (entry) => entry.user.toLowerCase() === traderAddress.toLowerCase(),
  );
  return row?.value ?? data[0]?.value ?? 0;
}

export async function fetchTraderPositions(
  traderAddress: string,
): Promise<{ positions: PositionSnapshot[]; truncated: boolean }> {
  const LIMIT = DATA_API_PAGE_LIMIT;
  const MAX_PAGES = DATA_API_MAX_PAGES;
  let offset = 0;
  const allPositions: DataApiPosition[] = [];
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${config.dataApi}/positions?user=${traderAddress}&limit=${LIMIT}&offset=${offset}&sizeThreshold=0`;
    const res = await rateLimitedFetch(url, dataApiPositionsBucket);
    if (!res.ok) throw new Error(`Data API error: ${res.status}`);
    const data = (await res.json()) as DataApiPosition[];
    allPositions.push(...data);

    if (data.length < LIMIT) break;
    offset += LIMIT;
    if (page === MAX_PAGES - 1) {
      truncated = true;
    }
  }

  return {
    positions: allPositions.map((p) => ({
      conditionId: p.conditionId,
      assetId: p.asset,
      size: Number(p.size),
      avgPrice:
        p.avgPrice == null || Number.isNaN(Number(p.avgPrice))
          ? undefined
          : Number(p.avgPrice),
      outcome: normalizeOutcome(p.outcome),
    })),
    truncated,
  };
}
