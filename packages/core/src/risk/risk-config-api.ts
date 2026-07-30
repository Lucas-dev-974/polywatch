import pino from 'pino';
import type { RiskConfig } from '../entities/RiskConfig.js';
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

const log = pino({ name: 'risk-config-api' });

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
      'invalid crypto-algo interval JSON in risk_config — using code defaults',
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
      'invalid crypto-algo interval JSON in risk_config — using code defaults',
    );
    return null;
  }
  return emptyMapToNull(parsed);
}

export type RiskConfigApi = Omit<
  RiskConfig,
  | 'simAllowedMarketTags'
  | 'realAllowedMarketTags'
  | 'cryptoAlgoStrategies'
  | 'cryptoAlgoSpreadAbsByInterval'
  | 'cryptoAlgoExitDefaultsByInterval'
  | 'cryptoAlgoPreCloseSecondsByInterval'
> & {
  simAllowedMarketTags: string[];
  realAllowedMarketTags: string[];
  cryptoAlgoStrategies: string[];
  cryptoAlgoSpreadAbsByInterval: CryptoAlgoNumberIntervalMap | null;
  cryptoAlgoExitDefaultsByInterval: CryptoAlgoExitDefaultsIntervalMap | null;
  cryptoAlgoPreCloseSecondsByInterval: CryptoAlgoNumberIntervalMap | null;
};

type MarketTagsUpdate = {
  simAllowedMarketTags?: string[];
  realAllowedMarketTags?: string[];
  cryptoAlgoStrategies?: string[];
};

type CryptoAlgoJsonUpdate = {
  cryptoAlgoSpreadAbsByInterval?: CryptoAlgoNumberIntervalMap | null;
  cryptoAlgoExitDefaultsByInterval?: CryptoAlgoExitDefaultsIntervalMap | null;
  cryptoAlgoPreCloseSecondsByInterval?: CryptoAlgoNumberIntervalMap | null;
};

export function presentRiskConfigForApi(config: RiskConfig): RiskConfigApi {
  return {
    ...config,
    simInitialCapital: config.simInitialCapitalCrypto,
    simAllowedMarketTags: parseAllowedMarketTags(config.simAllowedMarketTags),
    realAllowedMarketTags: parseAllowedMarketTags(config.realAllowedMarketTags),
    cryptoAlgoStrategies: parseCryptoAlgoStrategies(config.cryptoAlgoStrategies),
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

export function toRiskConfigEntityUpdate<T extends MarketTagsUpdate & CryptoAlgoJsonUpdate>(
  data: T,
): Omit<T, keyof MarketTagsUpdate | keyof CryptoAlgoJsonUpdate> & Partial<RiskConfig> {
  const {
    simAllowedMarketTags,
    realAllowedMarketTags,
    cryptoAlgoStrategies,
    cryptoAlgoSpreadAbsByInterval,
    cryptoAlgoExitDefaultsByInterval,
    cryptoAlgoPreCloseSecondsByInterval,
    ...rest
  } = data;
  const update: Partial<RiskConfig> = { ...rest };

  if (simAllowedMarketTags !== undefined) {
    update.simAllowedMarketTags =
      serializeAllowedMarketTags(simAllowedMarketTags);
  }
  if (realAllowedMarketTags !== undefined) {
    update.realAllowedMarketTags =
      serializeAllowedMarketTags(realAllowedMarketTags);
  }
  if (cryptoAlgoStrategies !== undefined) {
    update.cryptoAlgoStrategies =
      serializeAllowedMarketTags(cryptoAlgoStrategies);
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

  return update as Omit<T, keyof MarketTagsUpdate & keyof CryptoAlgoJsonUpdate> &
    Partial<RiskConfig>;
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
