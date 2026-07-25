import {
  TRADER_INSIGHT_ACTIVITY_PAGE_SIZE,
  TRADER_INSIGHT_MAX_ACTIVITY_OFFSET,
  TRADER_INSIGHT_MAX_ACTIVITY_PAGES,
} from '@polywatch/core';
import { fetchUserActivity, type DataApiActivity } from './data-api-client.js';
import { config } from '../config.js';

export interface FetchAllUserActivityOptions {
  type?: string | string[];
  pageSize?: number;
  maxPages?: number;
}

export interface FetchAllUserActivityResult {
  activities: DataApiActivity[];
  truncated: boolean;
}

function isActivityOffsetLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes('data_api_activity_400') &&
    err.message.includes('max historical activity offset')
  );
}

export async function fetchAllUserActivity(
  userAddress: string,
  options: FetchAllUserActivityOptions = {},
): Promise<FetchAllUserActivityResult> {
  const pageSize = Math.min(
    Math.max(options.pageSize ?? TRADER_INSIGHT_ACTIVITY_PAGE_SIZE, 1),
    500,
  );
  const maxPages = Math.max(
    options.maxPages ?? TRADER_INSIGHT_MAX_ACTIVITY_PAGES,
    1,
  );
  const all: DataApiActivity[] = [];
  let offset = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    if (offset > TRADER_INSIGHT_MAX_ACTIVITY_OFFSET) {
      truncated = true;
      break;
    }

    let batch: DataApiActivity[];
    try {
      batch = await fetchUserActivity(userAddress, {
        limit: pageSize,
        offset,
        type: options.type,
      });
    } catch (err) {
      if (offset > 0 && isActivityOffsetLimitError(err)) {
        truncated = true;
        break;
      }
      throw err;
    }

    all.push(...batch);
    if (batch.length < pageSize) break;

    offset += pageSize;
    if (offset > TRADER_INSIGHT_MAX_ACTIVITY_OFFSET) {
      truncated = true;
      break;
    }
    if (page === maxPages - 1) {
      truncated = true;
    }
  }

  return { activities: all, truncated };
}

export interface DataApiPositionRow {
  conditionId: string;
  asset: string;
  size: number;
  avgPrice?: number;
  outcome?: string;
  title?: string;
  slug?: string;
  currentValue?: number;
}

export async function fetchUserPositions(
  userAddress: string,
): Promise<DataApiPositionRow[]> {
  const params = new URLSearchParams({
    user: userAddress,
    limit: '500',
    offset: '0',
    sizeThreshold: '0',
  });
  const url = `${config.dataApi}/positions?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`data_api_positions_${res.status}`);
  }
  const data = (await res.json()) as DataApiPositionRow[];
  return Array.isArray(data) ? data : [];
}

export async function fetchUserPortfolioValue(
  userAddress: string,
): Promise<number | undefined> {
  const url = `${config.dataApi}/value?user=${encodeURIComponent(userAddress)}`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const data = (await res.json()) as { user: string; value: number }[];
  if (!Array.isArray(data)) return undefined;
  const row = data.find(
    (entry) => entry.user.toLowerCase() === userAddress.toLowerCase(),
  );
  return row?.value ?? data[0]?.value;
}

export interface GammaPublicProfile {
  address?: string;
  proxyWallet?: string;
  name?: string;
  pseudonym?: string;
  bio?: string;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

export async function fetchGammaPublicProfile(
  address: string,
): Promise<GammaPublicProfile | null> {
  const url = `${config.gammaApi}/public-profile?address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as GammaPublicProfile;
}
