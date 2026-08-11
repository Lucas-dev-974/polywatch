import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import type { TradingMode } from '../types/index.js';
import { parseIntervalToMs } from '../services/algo-surveillance-helpers.js';
import {
  getCopyPreCloseParams,
  getWeatherPreCloseParams,
  type ModePreCloseParams,
} from './policy.js';
import {
  getCryptoPositionPreCloseParams,
  resolveCryptoAlgoPreCloseSeconds,
} from './crypto-algo-exit.js';
import { algoKindFromReason } from '../simulation/algo-kind.js';

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
  risk: CryptoConfig,
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
export function getCryptoAlgoStrategies(risk: CryptoConfig): string[] {
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
export function getCryptoAlgoExitParams(risk: CryptoConfig): CryptoAlgoExitParams {
  return {
    trailingBidPoints: risk.cryptoAlgoTrailingBidPoints,
    trailingActivationBidPoints: risk.cryptoAlgoTrailingActivationBidPoints,
    cryptoAlgoSlBidPoints: risk.cryptoAlgoSlBidPoints,
    cryptoAlgoTpBidPoints: risk.cryptoAlgoTpBidPoints,
  };
}

/** Read nullable crypto-algo pre-close overrides from the risk config. */
export function getCryptoAlgoPreCloseParams(risk: CryptoConfig): CryptoAlgoPreCloseParams {
  return {
    preCloseEnabled: risk.cryptoAlgoPreCloseEnabled,
    preCloseSeconds: risk.cryptoAlgoPreCloseSeconds,
    preCloseKeepEnabled: risk.cryptoAlgoPreCloseKeepEnabled,
    preCloseKeepBidThreshold: risk.cryptoAlgoPreCloseKeepBidThreshold,
  };
}

/** Whether crypto-algo pre-close is active. */
export function isCryptoAlgoPreCloseEnabled(risk: CryptoConfig): boolean {
  return risk.cryptoAlgoPreCloseEnabled === true;
}

/**
 * Resolve pre-close settings for a position using the per-algo config.
 * Copy positions use copy-config pre-close columns; weather positions use
 * weather-config pre-close; crypto/algo positions use crypto-config overrides.
 */
export function getPositionPreCloseParams(
  cfg: CopyConfig | CryptoConfig | WeatherConfig,
  mode: TradingMode,
  positionReason: string | null | undefined,
  interval?: string | null,
  strategyId?: string | null,
): ModePreCloseParams {
  const algoKind = algoKindFromReason(positionReason);
  if (algoKind === 'copy') {
    return getCopyPreCloseParams(cfg as CopyConfig, mode);
  }
  if (algoKind === 'weather') {
    return getWeatherPreCloseParams(cfg as WeatherConfig, mode, strategyId);
  }
  return getCryptoPositionPreCloseParams(cfg as CryptoConfig, mode, interval);
}

/** Effective pre-close window for crypto-algo market refresh heuristics. */
export function getCryptoAlgoEffectivePreCloseSeconds(risk: CryptoConfig): number {
  return resolveCryptoAlgoPreCloseSeconds(risk, null);
}
