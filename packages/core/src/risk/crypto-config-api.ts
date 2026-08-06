import pino from 'pino';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  parseAllowedMarketTags,
  serializeAllowedMarketTags,
} from '../market/tags.js';
import type {
  CryptoAlgoExitDefaultsIntervalMap,
  CryptoAlgoNumberIntervalMap,
} from './crypto-algo-tunables.js';
import {
  parseCryptoAlgoIntervalJsonMap,
  parseCryptoAlgoIntervalNumberMap,
  serializeCryptoAlgoIntervalJsonMap,
  type CryptoAlgoIntervalExitDefaults,
} from './crypto-algo-tunables.js';
import {
  parseCryptoAlgoStrategyParams,
  serializeCryptoAlgoStrategyParams,
  type CryptoAlgoStrategyParamsMap,
} from './crypto-algo-strategy-params.js';

const log = pino({ name: 'crypto-config-api' });

/** Normalize empty override maps to null for a stable GET contract. */
export function emptyMapToNull<T extends object>(m: T | null): T | null {
  if (m == null) return null;
  return Object.keys(m).length === 0 ? null : m;
}

function isBlankIntervalJson(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const trimmed = raw.trim();
  return trimmed === '' || trimmed === 'null';
}

export function presentIntervalNumberMapForApi(
  field: string,
  raw: string | null | undefined,
): CryptoAlgoNumberIntervalMap | null {
  if (isBlankIntervalJson(raw)) return null;
  const parsed = parseCryptoAlgoIntervalNumberMap(raw);
  if (parsed == null) {
    log.warn(
      { field, preview: raw!.trim().slice(0, 80) },
      'invalid crypto-algo interval JSON in crypto_config — using code defaults',
    );
    return null;
  }
  return emptyMapToNull(parsed);
}

export function presentIntervalExitMapForApi(
  field: string,
  raw: string | null | undefined,
): CryptoAlgoExitDefaultsIntervalMap | null {
  if (isBlankIntervalJson(raw)) return null;
  const parsed = parseCryptoAlgoIntervalJsonMap<CryptoAlgoIntervalExitDefaults>(raw);
  if (parsed == null) {
    log.warn(
      { field, preview: raw!.trim().slice(0, 80) },
      'invalid crypto-algo interval JSON in crypto_config — using code defaults',
    );
    return null;
  }
  return emptyMapToNull(parsed);
}

/**
 * Parse the JSON array of enabled crypto-algo strategy ids. Falls back to an
 * empty array when the column is unset/invalid (mirrors parseAllowedMarketTags).
 */
export function parseCryptoAlgoStrategies(json: string | null | undefined): string[] {
  if (!json || json.trim() === '') return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
  } catch {
    return [];
  }
}

export type CryptoConfigApi = Omit<
  CryptoConfig,
  | 'cryptoAlgoStrategies'
  | 'cryptoAlgoAllowedMarketTags'
  | 'cryptoAlgoSpreadAbsByInterval'
  | 'cryptoAlgoExitDefaultsByInterval'
  | 'cryptoAlgoPreCloseSecondsByInterval'
  | 'cryptoAlgoStrategyParams'
> & {
  cryptoAlgoStrategies: string[];
  cryptoAlgoAllowedMarketTags: string[];
  cryptoAlgoSpreadAbsByInterval: CryptoAlgoNumberIntervalMap | null;
  cryptoAlgoExitDefaultsByInterval: CryptoAlgoExitDefaultsIntervalMap | null;
  cryptoAlgoPreCloseSecondsByInterval: CryptoAlgoNumberIntervalMap | null;
  cryptoAlgoStrategyParams: CryptoAlgoStrategyParamsMap;
};

type CryptoJsonArrayUpdate = {
  cryptoAlgoStrategies?: string[];
  cryptoAlgoAllowedMarketTags?: string[];
  cryptoAlgoStrategyParams?: CryptoAlgoStrategyParamsMap;
};

type CryptoAlgoJsonUpdate = {
  cryptoAlgoSpreadAbsByInterval?: CryptoAlgoNumberIntervalMap | null;
  cryptoAlgoExitDefaultsByInterval?: CryptoAlgoExitDefaultsIntervalMap | null;
  cryptoAlgoPreCloseSecondsByInterval?: CryptoAlgoNumberIntervalMap | null;
};

export function presentCryptoConfigForApi(config: CryptoConfig): CryptoConfigApi {
  return {
    ...config,
    cryptoAlgoStrategies: parseCryptoAlgoStrategies(config.cryptoAlgoStrategies),
    cryptoAlgoAllowedMarketTags: parseAllowedMarketTags(config.cryptoAlgoAllowedMarketTags),
    cryptoAlgoStrategyParams: parseCryptoAlgoStrategyParams(config.cryptoAlgoStrategyParams),
    cryptoAlgoSpreadAbsByInterval: presentIntervalNumberMapForApi(
      'cryptoAlgoSpreadAbsByInterval',
      config.cryptoAlgoSpreadAbsByInterval,
    ),
    cryptoAlgoExitDefaultsByInterval: presentIntervalExitMapForApi(
      'cryptoAlgoExitDefaultsByInterval',
      config.cryptoAlgoExitDefaultsByInterval,
    ),
    cryptoAlgoPreCloseSecondsByInterval: presentIntervalNumberMapForApi(
      'cryptoAlgoPreCloseSecondsByInterval',
      config.cryptoAlgoPreCloseSecondsByInterval,
    ),
  };
}

export function toCryptoConfigEntityUpdate<
  T extends CryptoJsonArrayUpdate & CryptoAlgoJsonUpdate,
>(
  data: T,
): Omit<T, keyof CryptoJsonArrayUpdate | keyof CryptoAlgoJsonUpdate> &
  Partial<CryptoConfig> {
  const {
    cryptoAlgoStrategies,
    cryptoAlgoAllowedMarketTags,
    cryptoAlgoStrategyParams,
    cryptoAlgoSpreadAbsByInterval,
    cryptoAlgoExitDefaultsByInterval,
    cryptoAlgoPreCloseSecondsByInterval,
    ...rest
  } = data;
  const update: Partial<CryptoConfig> = { ...rest };

  if (cryptoAlgoStrategies !== undefined) {
    update.cryptoAlgoStrategies = serializeAllowedMarketTags(cryptoAlgoStrategies);
  }
  if (cryptoAlgoAllowedMarketTags !== undefined) {
    update.cryptoAlgoAllowedMarketTags = serializeAllowedMarketTags(
      cryptoAlgoAllowedMarketTags,
    );
  }
  if (cryptoAlgoStrategyParams !== undefined) {
    update.cryptoAlgoStrategyParams = serializeCryptoAlgoStrategyParams(
      cryptoAlgoStrategyParams,
    );
  }
  if (cryptoAlgoSpreadAbsByInterval !== undefined) {
    update.cryptoAlgoSpreadAbsByInterval = serializeCryptoAlgoIntervalJsonMap(
      cryptoAlgoSpreadAbsByInterval,
    );
  }
  if (cryptoAlgoExitDefaultsByInterval !== undefined) {
    update.cryptoAlgoExitDefaultsByInterval = serializeCryptoAlgoIntervalJsonMap(
      cryptoAlgoExitDefaultsByInterval,
    );
  }
  if (cryptoAlgoPreCloseSecondsByInterval !== undefined) {
    update.cryptoAlgoPreCloseSecondsByInterval = serializeCryptoAlgoIntervalJsonMap(
      cryptoAlgoPreCloseSecondsByInterval,
    );
  }

  return update as Omit<T, keyof CryptoJsonArrayUpdate | keyof CryptoAlgoJsonUpdate> &
    Partial<CryptoConfig>;
}
