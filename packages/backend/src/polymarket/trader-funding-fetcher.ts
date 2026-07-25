import {
  COLLATERAL_TOKEN_DEFINITIONS,
  buildPolymarketInternalContracts,
  buildTraderFundingAnalysis,
  collateralTokenSlugForAddress,
  resolveTraderFundingAddresses,
  type TokenTransferInput,
  type TraderFundingAnalysis,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import {
  fetchAllPolygonscanTokenTransfers,
  parsePolygonscanTokenValueUsdc,
  PolygonscanApiError,
  type PolygonscanTokenTxRow,
} from './polygonscan-client.js';
import { resolvePolygonscanApiKey } from './polygonscan-settings.js';
import type { GammaPublicProfile } from './trader-insight-fetcher.js';
import { resolveBackendConfig } from '../system-config-resolver.js';

const log = pino({ name: 'trader-funding' });
const FUNDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function resolveFundingCacheTtlMs(): Promise<number> {
  return resolveBackendConfig('backend.cache.funding.ttl_ms', FUNDING_CACHE_TTL_MS);
}
const fundingCache = new Map<
  string,
  { data: TraderFundingAnalysis; expiresAt: number }
>();

function transferKey(row: PolygonscanTokenTxRow): string {
  return `${row.hash.toLowerCase()}:${row.logIndex ?? '0'}:${row.contractAddress.toLowerCase()}`;
}

function rowToTransferInput(row: PolygonscanTokenTxRow): TokenTransferInput | null {
  const token = collateralTokenSlugForAddress(row.contractAddress);
  if (!token) return null;

  const timestamp = Number(row.timeStamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  return {
    token,
    from: row.from,
    to: row.to,
    valueUsdc: parsePolygonscanTokenValueUsdc(row),
    timestamp,
    txHash: row.hash,
    logIndex: row.logIndex != null ? Number(row.logIndex) : undefined,
  };
}

export type TraderFundingFetchResult =
  | { ok: true; funding: TraderFundingAnalysis }
  | {
      ok: false;
      reason:
        | 'missing_api_key'
        | 'invalid_api_key'
        | 'rate_limit'
        | 'polygonscan_error';
    };

export function clearTraderFundingCache(): void {
  fundingCache.clear();
}

export function invalidateTraderFundingCacheForAddress(address: string): void {
  const normalized = address.toLowerCase();
  for (const key of [...fundingCache.keys()]) {
    if (key.split(':').includes(normalized)) {
      fundingCache.delete(key);
    }
  }
}

function mapPolygonscanError(err: unknown): TraderFundingFetchResult {
  if (err instanceof PolygonscanApiError) {
    if (err.code === 'missing_api_key' || err.code === 'invalid_api_key') {
      return { ok: false, reason: err.code };
    }
    if (err.code === 'rate_limit') {
      return { ok: false, reason: 'rate_limit' };
    }
  }
  return { ok: false, reason: 'polygonscan_error' };
}

export async function fetchTraderFundingAnalysis(
  ds: DataSource,
  proxyWallet: string,
  gammaProfile: GammaPublicProfile | null,
): Promise<TraderFundingFetchResult> {
  const apiKey = await resolvePolygonscanApiKey(ds);
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key' };
  }

  const watchedAddresses = resolveTraderFundingAddresses(proxyWallet, {
    address: gammaProfile?.address,
    proxyWallet: gammaProfile?.proxyWallet,
  });
  const cacheKey = watchedAddresses.sort().join(':');
  const cached = fundingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { ok: true, funding: cached.data };
  }

  const internalContracts = buildPolymarketInternalContracts();
  const transferMap = new Map<string, TokenTransferInput>();
  const fetchesTotal =
    watchedAddresses.length * COLLATERAL_TOKEN_DEFINITIONS.length;
  let fetchesCompleted = 0;
  let truncated = false;
  let partialFetch = false;
  let lastError: unknown = null;

  try {
    for (const wallet of watchedAddresses) {
      for (const tokenDef of COLLATERAL_TOKEN_DEFINITIONS) {
        try {
          const result = await fetchAllPolygonscanTokenTransfers(
            wallet,
            tokenDef.address,
            apiKey,
          );
          fetchesCompleted += 1;
          if (result.truncated) truncated = true;
          for (const row of result.rows) {
            const input = rowToTransferInput(row);
            if (!input) continue;
            transferMap.set(transferKey(row), input);
          }
        } catch (err) {
          lastError = err;
          partialFetch = true;
          log.warn(
            {
              err,
              wallet,
              token: tokenDef.slug,
              contract: tokenDef.address,
            },
            'polygonscan token fetch failed',
          );
          if (err instanceof PolygonscanApiError) {
            if (
              err.code === 'missing_api_key' ||
              err.code === 'invalid_api_key' ||
              err.code === 'rate_limit'
            ) {
              return mapPolygonscanError(err);
            }
          }
        }
      }
    }

    if (fetchesCompleted === 0) {
      log.warn({ err: lastError, proxyWallet }, 'trader funding fetch failed');
      return mapPolygonscanError(lastError);
    }

    if (fetchesCompleted < fetchesTotal) {
      partialFetch = true;
      truncated = true;
    }

    const funding = buildTraderFundingAnalysis(
      [...transferMap.values()],
      watchedAddresses,
      internalContracts,
      {
        truncated,
        coverage: {
          fetchesCompleted,
          fetchesTotal,
          partialFetch,
        },
      },
    );

    fundingCache.set(cacheKey, {
      data: funding,
      expiresAt: Date.now() + FUNDING_CACHE_TTL_MS,
    });

    log.info(
      {
        proxyWallet,
        rawTransferCount: funding.coverage.rawTransferCount,
        classifiedTransferCount: funding.coverage.classifiedTransferCount,
        truncated: funding.truncated,
        partialFetch: funding.coverage.partialFetch,
        fetchesCompleted,
        fetchesTotal,
      },
      'trader funding analysis built',
    );

    return { ok: true, funding };
  } catch (err) {
    log.warn({ err, proxyWallet }, 'trader funding fetch failed');
    return mapPolygonscanError(err);
  }
}
