import type { CryptoConfig } from '../entities/CryptoConfig.js';

/** Shared optional overrides available to any strategy. */
export interface CryptoAlgoStrategyParamsBag {
  /** Override min time-to-close (seconds) for this strategy only. */
  minTimeToClose?: number | null;
  /** Opaque exit profile id / JSON fragment for future exit overrides. */
  exitProfile?: string | Record<string, unknown> | null;
  [key: string]: unknown;
}

export type CryptoAlgoStrategyParamsMap = Record<string, CryptoAlgoStrategyParamsBag>;

export function parseCryptoAlgoStrategyParams(
  raw: string | null | undefined,
): CryptoAlgoStrategyParamsMap {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as CryptoAlgoStrategyParamsMap;
  } catch {
    return {};
  }
}

export function serializeCryptoAlgoStrategyParams(
  value: CryptoAlgoStrategyParamsMap | null | undefined,
): string {
  if (!value || typeof value !== 'object') return '{}';
  return JSON.stringify(value);
}

export function getStrategyParams(
  risk: CryptoConfig,
  strategyId: string,
): CryptoAlgoStrategyParamsBag {
  const map = parseCryptoAlgoStrategyParams(risk.cryptoAlgoStrategyParams);
  return map[strategyId] ?? {};
}

/**
 * Return the per-strategy `minTimeToClose` override from `cryptoAlgoStrategyParams` only.
 * Missing / non-finite → `null` so the caller can chain global → interval default
 * via `resolveCryptoAlgoMinTimeToClose`.
 */
export function resolveStrategyMinTimeToClose(
  risk: CryptoConfig,
  strategyId: string,
): number | null {
  const params = getStrategyParams(risk, strategyId);
  if (typeof params.minTimeToClose === 'number' && Number.isFinite(params.minTimeToClose)) {
    return params.minTimeToClose;
  }
  return null;
}
