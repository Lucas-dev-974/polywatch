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

interface CachedEntry {
  context: TradingContext;
  expiresAt: number;
  collateralSyncedAt: number;
}

let cached: CachedEntry | null = null;
let loadInFlight: Promise<TradingContextResult> | null = null;

async function buildTradingContext(): Promise<TradingContextResult> {
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
  await syncDepositWalletCollateralCache(clobClient);

  try {
    const approvalsUrl = `${config.backendUrl}/api/internal/clob-approvals/ensure`;
    const approvalsRes = await fetch(approvalsUrl, {
      method: 'POST',
      headers: { 'x-service-token': config.serviceToken },
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

  cached = {
    context,
    expiresAt: now + CACHE_TTL_MS,
    collateralSyncedAt: now,
  };

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

  if (loadInFlight) {
    return loadInFlight;
  }

  loadInFlight = buildTradingContext().finally(() => {
    loadInFlight = null;
  });
  return loadInFlight;
}

export async function loadTradingContext(): Promise<TradingContext | null> {
  const result = await loadTradingContextResult();
  return result.ok ? result.context : null;
}

export function clearTradingContextCache(): void {
  cached = null;
}

export async function refreshTradingContext(): Promise<TradingContext | null> {
  clearTradingContextCache();
  return loadTradingContext();
}
