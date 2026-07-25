import { config } from '../config.js';

export interface DataApiActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: string;
  outcomeIndex: number;
  title: string;
  slug: string;
  outcome: string;
}

export interface FetchUserActivityOptions {
  limit?: number;
  offset?: number;
  type?: string | string[];
}

export async function fetchUserActivity(
  userAddress: string,
  options: FetchUserActivityOptions = {},
): Promise<DataApiActivity[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  const params = new URLSearchParams({
    user: userAddress,
    limit: String(limit),
    offset: String(offset),
  });

  if (options.type != null) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    if (types.length > 0) {
      params.set('type', types.join(','));
    }
  }

  const url = `${config.dataApi}/activity?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`data_api_activity_${res.status}${text ? `: ${text}` : ''}`);
  }

  const data = (await res.json()) as DataApiActivity[];
  return Array.isArray(data) ? data : [];
}
