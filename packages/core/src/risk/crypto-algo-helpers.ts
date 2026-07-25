import type { RiskConfig } from '../entities/RiskConfig.js';
import type { TradingMode } from '../types/index.js';
import { parseIntervalToMs } from '../services/algo-surveillance-helpers.js';
import { getModePreCloseParams, type ModePreCloseParams } from './policy.js';

/** Default re-entry window when interval and risk override are unavailable. */
export const CRYPTO_ALGO_DEFAULT_REENTRY_WINDOW_MS = 60 * 60 * 1000;

/** Default max confirmed fills per re-entry window per outcome. */
export const CRYPTO_ALGO_DEFAULT_MAX_ENTRIES_PER_WINDOW = 1;

export interface CryptoAlgoReentryParams {
  windowMs: number;
  maxEntries: number;
}

/**
 * Resolve effective re-entry throttle for a market selection.
 * Window: risk override → interval duration → 1h default.
 * Max entries: risk override → 1.
 */
export function resolveCryptoAlgoReentryParams(
  risk: RiskConfig,
  interval: string | null | undefined,
): CryptoAlgoReentryParams {
  const windowMs =
    risk.cryptoAlgoReentryWindowMs ??
    parseIntervalToMs(interval) ??
    CRYPTO_ALGO_DEFAULT_REENTRY_WINDOW_MS;
  const maxEntries =
    risk.cryptoAlgoMaxEntriesPerWindow ?? CRYPTO_ALGO_DEFAULT_MAX_ENTRIES_PER_WINDOW;
  return { windowMs, maxEntries };
}

/**
 * Parse the JSON array of enabled crypto-algo strategy ids from the risk
 * config. Falls back to an empty array when the column is unset/invalid.
 */
export function getCryptoAlgoStrategies(risk: RiskConfig): string[] {
  try {
    const parsed = JSON.parse(risk.cryptoAlgoStrategies) as unknown;
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export interface CryptoAlgoExitParams {
  trailingBidPoints: number | null;
  trailingActivationBidPoints: number | null;
  cryptoAlgoSlBidPoints: number | null | undefined;
  cryptoAlgoTpBidPoints: number | null | undefined;
}

export interface CryptoAlgoPreCloseParams {
  preCloseEnabled: boolean | null;
  preCloseSeconds: number | null;
  preCloseKeepEnabled: boolean | null;
  preCloseKeepBidThreshold: number | null;
}

export function isAlgoPositionReason(reason: string | null | undefined): boolean {
  return reason != null && reason.startsWith('ALGO_');
}

/**
 * Read raw crypto-algo exit overrides from the risk config.
 * Null = not overridden (resolved at entry via {@link resolveAlgoEntryExitParams}).
 * Zero = explicitly disabled.
 */
export function getCryptoAlgoExitParams(risk: RiskConfig): CryptoAlgoExitParams {
  return {
    trailingBidPoints: risk.cryptoAlgoTrailingBidPoints,
    trailingActivationBidPoints: risk.cryptoAlgoTrailingActivationBidPoints,
    cryptoAlgoSlBidPoints: risk.cryptoAlgoSlBidPoints,
    cryptoAlgoTpBidPoints: risk.cryptoAlgoTpBidPoints,
  };
}

/** Read nullable crypto-algo pre-close overrides from the risk config. */
export function getCryptoAlgoPreCloseParams(risk: RiskConfig): CryptoAlgoPreCloseParams {
  return {
    preCloseEnabled: risk.cryptoAlgoPreCloseEnabled,
    preCloseSeconds: risk.cryptoAlgoPreCloseSeconds,
    preCloseKeepEnabled: risk.cryptoAlgoPreCloseKeepEnabled,
    preCloseKeepBidThreshold: risk.cryptoAlgoPreCloseKeepBidThreshold,
  };
}

/** Whether crypto-algo pre-close is active (explicitly or via mode inheritance). */
export function isCryptoAlgoPreCloseEnabled(risk: RiskConfig): boolean {
  if (risk.cryptoAlgoPreCloseEnabled === true) return true;
  if (risk.cryptoAlgoPreCloseEnabled === false) return false;
  return risk.simPreCloseEnabled || risk.realPreCloseEnabled;
}

/**
 * Resolve pre-close settings for a position. ALGO_* positions may override the
 * sim/real defaults via the crypto-algo columns; copy positions keep mode params.
 */
export function getPositionPreCloseParams(
  risk: RiskConfig,
  mode: TradingMode,
  positionReason: string | null | undefined,
  interval?: string | null,
): ModePreCloseParams {
  return getAlgoPositionPreCloseParams(risk, mode, positionReason, interval);
}

/** Effective pre-close window for crypto-algo market refresh heuristics. */
export function getCryptoAlgoEffectivePreCloseSeconds(risk: RiskConfig): number {
  return resolveCryptoAlgoPreCloseSeconds(risk, null);
}

import {
  getAlgoPositionPreCloseParams,
  resolveCryptoAlgoPreCloseSeconds,
} from './crypto-algo-exit.js';
