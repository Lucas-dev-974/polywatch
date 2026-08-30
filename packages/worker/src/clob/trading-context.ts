import {
  evaluateLiveTradingReadiness,
  resolveDepositAddress,
  resolveWalletAddresses,
  type LiveTradingBlockReason,
} from '@polywatch/core';
import type { ClobClient } from '@polymarket/clob-client-v2';
import { syncDepositWalletCollateralCache } from './clob-cache-sync.js';
import { createDepositWalletClobClient } from './client-factory.js';
import {
  fetchInternalClobCredentials,
  parseApiClobCredentials,
} from './credentials.js';
import { config } from '../config.js';
import pino from 'pino';

const log = pino({ name: 'trading-context' });

export interface TradingContext {
  depositAddress: string;
  eoaAddress: string;
  clobClient: ClobClient;
  wsAuth: {
    apiKey: string;
    secret: string;
    passphrase: string;
  };
}

export type TradingContextLoadError =
  | LiveTradingBlockReason
  | 'clob_approvals_failed';

export type TradingContextResult =
  | { ok: true; context: TradingContext }
  | { ok: false; error: TradingContextLoadError };

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const COLLATERAL_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
/** Covers on-chain check + optional relayer batch + waitForTransaction (60 s). */
const CLOB_APPROVALS_ENSURE_TIMEOUT_MS = 90_000;

interface CachedEntry {
  context: TradingContext;
  expiresAt: number;
  collateralSyncedAt: number;
}

let cached: CachedEntry | null = null;
let loadInFlight: Promise<TradingContextResult> | null = null;
/** Bumped by clearTradingContextCache so in-flight builds never rewrite stale credentials. */
let cacheGeneration = 0;
let loadInFlightGeneration = 0;

async function buildTradingContext(
  generation: number,
): Promise<TradingContextResult> {
  const now = Date.now();

  const data = await fetchInternalClobCredentials();
  if (!data) {
    return { ok: false, error: 'clob_credentials_not_found' };
  }

  const readiness = evaluateLiveTradingReadiness({
    hasClobCredentials: true,
    hasApiKey: !!data.apiKey,
    hasSecret: !!data.secret,
    hasPassphrase: !!data.passphrase,
    hasSignerPk: !!data.signerPrivateKey,
    signatureType: data.signatureType,
    depositAddress: resolveDepositAddress(
      data.walletAddress,
      data.funderAddress,
      null,
    ),
  });

  if (!readiness.liveReady) {
    return { ok: false, error: readiness.blockReason! };
  }

  const apiCreds = parseApiClobCredentials(data);
  if (!apiCreds) {
    return { ok: false, error: 'clob_credentials_incomplete' };
  }

  const depositAddress = readiness.liveReady
    ? resolveDepositAddress(data.walletAddress, data.funderAddress, null)!
    : null;
  if (!depositAddress) {
    return { ok: false, error: 'no_deposit_address' };
  }

  const { eoaAddress } = resolveWalletAddresses(
    data.walletAddress,
    data.funderAddress,
    null,
  );

  const clobClient = createDepositWalletClobClient(apiCreds, depositAddress);

  try {
    const approvalsUrl = `${config.backendUrl}/api/internal/clob-approvals/ensure`;
    const approvalsRes = await fetch(approvalsUrl, {
      method: 'POST',
      headers: { 'x-service-token': config.serviceToken },
      signal: AbortSignal.timeout(CLOB_APPROVALS_ENSURE_TIMEOUT_MS),
    });
    if (!approvalsRes.ok) {
      log.warn({ status: approvalsRes.status }, 'clob approvals check failed');
      return { ok: false, error: 'clob_approvals_failed' };
    }
    log.info('clob approvals ensured');
  } catch (err) {
    log.warn({ err }, 'clob approvals request failed');
    return { ok: false, error: 'clob_approvals_failed' };
  }

  // Sync AFTER ensure so a freshly mined adapter/exchange approve is visible
  // to the CLOB matcher (server-side balance/allowance cache).
  await syncDepositWalletCollateralCache(clobClient);

  const context: TradingContext = {
    depositAddress,
    eoaAddress: eoaAddress ?? depositAddress,
    clobClient,
    wsAuth: {
      apiKey: apiCreds.apiKey,
      secret: apiCreds.secret,
      passphrase: apiCreds.passphrase,
    },
  };

  // Cache only if this build still matches the current generation.
  if (generation === cacheGeneration) {
    cached = {
      context,
      expiresAt: now + CACHE_TTL_MS,
      collateralSyncedAt: now,
    };
  }

  return { ok: true, context };
}

export async function loadTradingContextResult(): Promise<TradingContextResult> {
  const now = Date.now();

  if (cached && now < cached.expiresAt) {
    if (now - cached.collateralSyncedAt >= COLLATERAL_SYNC_INTERVAL_MS) {
      void syncDepositWalletCollateralCache(cached.context.clobClient).catch(
        (err) => log.warn({ err }, 'periodic collateral sync failed'),
      );
      cached.collateralSyncedAt = now;
    }
    return { ok: true, context: cached.context };
  }

  const generation = cacheGeneration;
  if (loadInFlight && loadInFlightGeneration === generation) {
    return loadInFlight;
  }

  const promise = buildTradingContext(generation).finally(() => {
    if (loadInFlight === promise) {
      loadInFlight = null;
    }
  });
  loadInFlight = promise;
  loadInFlightGeneration = generation;
  return promise;
}

export async function loadTradingContext(): Promise<TradingContext | null> {
  const result = await loadTradingContextResult();
  return result.ok ? result.context : null;
}

export function clearTradingContextCache(): void {
  cached = null;
  cacheGeneration += 1;
}

export async function refreshTradingContext(): Promise<TradingContext | null> {
  clearTradingContextCache();
  return loadTradingContext();
}
