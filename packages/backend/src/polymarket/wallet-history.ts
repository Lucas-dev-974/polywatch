import { getRedemptionPayoff, Market } from '@polywatch/core';
import type { DataSource } from 'typeorm';
import {
  fetchUserActivity,
  type DataApiActivity,
} from './data-api-client.js';

export type WalletHistoryCategory =
  | 'trade'
  | 'redeem'
  | 'split'
  | 'merge'
  | 'other';

export interface WalletHistoryEntry {
  id: string;
  timestamp: number;
  category: WalletHistoryCategory;
  title: string;
  amount: number | null;
  asset: string;
  side: 'BUY' | 'SELL' | null;
  price: number | null;
  txHash: string | null;
  explorerUrl: string | null;
  source: 'polymarket';
}

export interface WalletHistoryResponse {
  entries: WalletHistoryEntry[];
  queriedAddress: string;
  limit: number;
  offset: number;
}

const POLYGONSCAN_TX = 'https://polygonscan.com/tx/';

function mapActivityCategory(type: string): WalletHistoryCategory {
  switch (type.toUpperCase()) {
    case 'TRADE':
      return 'trade';
    case 'REDEEM':
      return 'redeem';
    case 'SPLIT':
      return 'split';
    case 'MERGE':
      return 'merge';
    default:
      return 'other';
  }
}

function formatActivityTitle(activity: DataApiActivity): string {
  const market = activity.title?.trim() || activity.slug || 'Marche inconnu';
  const outcome = activity.outcome?.trim();

  switch (activity.type.toUpperCase()) {
    case 'TRADE': {
      const action = activity.side === 'SELL' ? 'Vente' : 'Achat';
      return outcome ? `${action} — ${market} (${outcome})` : `${action} — ${market}`;
    }
    case 'REDEEM':
      return `Rachat — ${market}`;
    case 'SPLIT':
      return `Split — ${market}`;
    case 'MERGE':
      return `Fusion — ${market}`;
    default:
      return `${activity.type} — ${market}`;
  }
}

function resolveRedemptionPrice(
  activity: DataApiActivity,
  marketByConditionId: Map<string, Market>,
): number | null {
  // Zero-cash redeem (wrong collateral / empty wallet) must not show price 1.00
  // from theoretical winning payoff.
  if (!Number.isFinite(activity.usdcSize) || activity.usdcSize <= 0) {
    return null;
  }
  const market = marketByConditionId.get(activity.conditionId.toLowerCase());
  if (!market?.winningTokenId) return null;
  return getRedemptionPayoff(market.winningTokenId, activity.asset);
}

export function mapActivityToHistoryEntry(
  activity: DataApiActivity,
  marketByConditionId: Map<string, Market> = new Map(),
): WalletHistoryEntry {
  const txHash = activity.transactionHash?.trim() || null;
  const side =
    activity.side === 'BUY' || activity.side === 'SELL' ? activity.side : null;
  const category = mapActivityCategory(activity.type);

  let price: number | null =
    Number.isFinite(activity.price) && activity.price > 0 ? activity.price : null;
  if (category === 'redeem' && price == null) {
    price = resolveRedemptionPrice(activity, marketByConditionId);
  }

  return {
    id: `polymarket:${txHash ?? 'no-tx'}:${activity.type}:${activity.timestamp}:${activity.conditionId}`,
    timestamp: activity.timestamp * 1000,
    category,
    title: formatActivityTitle(activity),
    amount: Number.isFinite(activity.usdcSize) ? activity.usdcSize : null,
    asset: 'USDC',
    side,
    price,
    txHash,
    explorerUrl: txHash ? `${POLYGONSCAN_TX}${txHash}` : null,
    source: 'polymarket',
  };
}

export function mapActivitiesToHistoryEntries(
  activities: DataApiActivity[],
  marketByConditionId: Map<string, Market> = new Map(),
): WalletHistoryEntry[] {
  return activities
    .map((a) => mapActivityToHistoryEntry(a, marketByConditionId))
    .sort((a, b) => b.timestamp - a.timestamp);
}

async function loadMarketsForRedemptions(
  ds: DataSource,
  activities: DataApiActivity[],
): Promise<Map<string, Market>> {
  const redeemConditionIds = activities
    .filter((a) => mapActivityCategory(a.type) === 'redeem')
    .map((a) => a.conditionId.toLowerCase());

  const uniqueConditionIds = [...new Set(redeemConditionIds)];
  if (uniqueConditionIds.length === 0) return new Map();

  const markets = await ds
    .getRepository(Market)
    .createQueryBuilder('m')
    .where('LOWER(m.condition_id) IN (:...ids)', { ids: uniqueConditionIds })
    .getMany();

  return new Map(markets.map((m) => [m.conditionId.toLowerCase(), m]));
}

export async function fetchWalletAccountHistory(
  depositAddress: string,
  options: { limit?: number; offset?: number; ds?: DataSource } = {},
): Promise<WalletHistoryResponse> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const activities = await fetchUserActivity(depositAddress, { limit, offset });
  const marketByConditionId = options.ds
    ? await loadMarketsForRedemptions(options.ds, activities)
    : new Map<string, Market>();
  const entries = mapActivitiesToHistoryEntries(activities, marketByConditionId);

  return {
    entries,
    queriedAddress: depositAddress,
    limit,
    offset,
  };
}
