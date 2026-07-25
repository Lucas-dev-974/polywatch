import {
  type CollateralTokenSlug,
  isPolymarketOffRamp,
  isPolymarketOnRamp,
} from '../polymarket/collateral-tokens.js';
import type {
  TraderFundingAnalysis,
  TraderFundingCoverage,
  TraderFundingSummary,
  TraderFundingTimelinePoint,
  TraderFundingTransfer,
} from '../types/trader-insight.js';

const MS_PER_WEEK = 7 * 86_400_000;
const POLYGONSCAN_TX = 'https://polygonscan.com/tx/';

export interface TokenTransferInput {
  token: CollateralTokenSlug;
  from: string;
  to: string;
  valueUsdc: number;
  timestamp: number;
  txHash: string;
  logIndex?: number;
}

export type FundingTransferDirection = 'deposit' | 'withdrawal' | 'internal';

export interface ClassifiedFundingTransfer extends TokenTransferInput {
  direction: FundingTransferDirection;
  walletAddress: string;
  counterparty: string;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function isWatchedAddress(address: string, watched: Set<string>): boolean {
  return watched.has(normalizeAddress(address));
}

function isInternalContract(address: string, internal: Set<string>): boolean {
  return internal.has(normalizeAddress(address));
}

export function classifyTokenTransfer(
  transfer: TokenTransferInput,
  watchedAddresses: string[],
  internalContracts: Set<string>,
): ClassifiedFundingTransfer | null {
  if (!Number.isFinite(transfer.valueUsdc) || transfer.valueUsdc <= 0) {
    return null;
  }

  const watched = new Set(watchedAddresses.map(normalizeAddress));
  const from = normalizeAddress(transfer.from);
  const to = normalizeAddress(transfer.to);
  const fromWatched = isWatchedAddress(from, watched);
  const toWatched = isWatchedAddress(to, watched);

  if (fromWatched && toWatched) {
    return null;
  }

  const fromInternal = isInternalContract(from, internalContracts);
  const toInternal = isInternalContract(to, internalContracts);

  if (transfer.token === 'pUSD') {
    if (toWatched && isPolymarketOnRamp(from)) {
      return {
        ...transfer,
        direction: 'deposit',
        walletAddress: to,
        counterparty: from,
      };
    }
    if (fromWatched && isPolymarketOffRamp(to)) {
      return {
        ...transfer,
        direction: 'withdrawal',
        walletAddress: from,
        counterparty: to,
      };
    }
    if (fromInternal || toInternal) return null;
  } else {
    if (fromInternal || toInternal) return null;
  }

  if (toWatched && !fromInternal) {
    return {
      ...transfer,
      direction: 'deposit',
      walletAddress: to,
      counterparty: from,
    };
  }

  if (fromWatched && !toInternal) {
    return {
      ...transfer,
      direction: 'withdrawal',
      walletAddress: from,
      counterparty: to,
    };
  }

  return null;
}

function weekStartKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function weekStartMs(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

function enumerateWeekKeys(firstMs: number, lastMs: number): string[] {
  const keys: string[] = [];
  let cursor = weekStartMs(weekStartKey(firstMs));
  const end = weekStartMs(weekStartKey(lastMs));
  while (cursor <= end) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += MS_PER_WEEK;
  }
  return keys.length > 0 ? keys : [weekStartKey(firstMs)];
}

export function buildFundingSummary(
  classified: ClassifiedFundingTransfer[],
): TraderFundingSummary {
  let totalDepositedUsdc = 0;
  let totalWithdrawnUsdc = 0;
  let depositCount = 0;
  let withdrawalCount = 0;
  let firstDepositAt: number | null = null;
  let lastDepositAt: number | null = null;

  for (const row of classified) {
    if (row.direction === 'deposit') {
      totalDepositedUsdc += row.valueUsdc;
      depositCount += 1;
      if (firstDepositAt == null || row.timestamp < firstDepositAt) {
        firstDepositAt = row.timestamp;
      }
      if (lastDepositAt == null || row.timestamp > lastDepositAt) {
        lastDepositAt = row.timestamp;
      }
    } else if (row.direction === 'withdrawal') {
      totalWithdrawnUsdc += row.valueUsdc;
      withdrawalCount += 1;
    }
  }

  return {
    totalDepositedUsdc,
    totalWithdrawnUsdc,
    netDepositedUsdc: totalDepositedUsdc - totalWithdrawnUsdc,
    depositCount,
    withdrawalCount,
    firstDepositAt,
    lastDepositAt,
  };
}

export function buildFundingTimeline(
  classified: ClassifiedFundingTransfer[],
): TraderFundingTimelinePoint[] {
  if (classified.length === 0) return [];

  const sorted = [...classified].sort((a, b) => a.timestamp - b.timestamp);
  const firstMs = sorted[0]!.timestamp * 1000;
  const lastMs = sorted[sorted.length - 1]!.timestamp * 1000;
  const weekKeys = enumerateWeekKeys(firstMs, lastMs);

  let eventIdx = 0;
  let cumulativeNet = 0;
  const points: TraderFundingTimelinePoint[] = [];

  for (const weekKey of weekKeys) {
    const weekEndSec = Math.floor((weekStartMs(weekKey) + MS_PER_WEEK - 1) / 1000);
    while (
      eventIdx < sorted.length &&
      sorted[eventIdx]!.timestamp <= weekEndSec
    ) {
      const row = sorted[eventIdx]!;
      cumulativeNet +=
        row.direction === 'deposit' ? row.valueUsdc : -row.valueUsdc;
      eventIdx++;
    }
    points.push({
      t: new Date(weekStartMs(weekKey) + MS_PER_WEEK - 1).toISOString(),
      cumulativeNetUsdc: cumulativeNet,
    });
  }

  return points;
}

export function buildRecentFundingTransfers(
  classified: ClassifiedFundingTransfer[],
  limit = 50,
): TraderFundingTransfer[] {
  return [...classified]
    .filter(
      (row): row is ClassifiedFundingTransfer & { direction: 'deposit' | 'withdrawal' } =>
        row.direction !== 'internal',
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((row) => ({
      id: `${row.txHash}:${row.logIndex ?? 0}:${row.direction}:${row.token}`,
      timestamp: row.timestamp * 1000,
      direction: row.direction,
      token: row.token,
      amountUsdc: row.valueUsdc,
      counterparty: row.counterparty,
      txHash: row.txHash,
      explorerUrl: `${POLYGONSCAN_TX}${row.txHash}`,
    }));
}

export function classifyTokenTransfers(
  transfers: TokenTransferInput[],
  watchedAddresses: string[],
  internalContracts: Set<string>,
): ClassifiedFundingTransfer[] {
  const classified: ClassifiedFundingTransfer[] = [];
  for (const transfer of transfers) {
    const row = classifyTokenTransfer(
      transfer,
      watchedAddresses,
      internalContracts,
    );
    if (row) classified.push(row);
  }
  return classified;
}

export function buildTraderFundingAnalysis(
  transfers: TokenTransferInput[],
  watchedAddresses: string[],
  internalContracts: Set<string>,
  options: {
    truncated?: boolean;
    coverage?: Partial<TraderFundingCoverage>;
  } = {},
): TraderFundingAnalysis {
  const classified = classifyTokenTransfers(
    transfers,
    watchedAddresses,
    internalContracts,
  );

  const depositWithdrawals = classified.filter(
    (row) => row.direction === 'deposit' || row.direction === 'withdrawal',
  );

  return {
    summary: buildFundingSummary(classified),
    timeline: buildFundingTimeline(classified),
    recentTransfers: buildRecentFundingTransfers(classified),
    truncated: options.truncated ?? false,
    addressesAnalyzed: [...new Set(watchedAddresses.map(normalizeAddress))],
    coverage: {
      rawTransferCount: transfers.length,
      classifiedTransferCount: depositWithdrawals.length,
      fetchesCompleted: options.coverage?.fetchesCompleted ?? 0,
      fetchesTotal: options.coverage?.fetchesTotal ?? 0,
      partialFetch: options.coverage?.partialFetch ?? false,
    },
  };
}

export function resolveTraderFundingAddresses(
  proxyWallet: string,
  profile: { address?: string; proxyWallet?: string } | null = null,
): string[] {
  const addresses = new Set<string>([normalizeAddress(proxyWallet)]);
  const profileAddress = profile?.address?.toLowerCase();
  const profileProxy = profile?.proxyWallet?.toLowerCase();
  if (profileAddress) addresses.add(profileAddress);
  if (profileProxy) addresses.add(profileProxy);
  return [...addresses];
}
