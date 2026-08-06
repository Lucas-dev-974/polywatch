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
  serializeCryptoAlgoIntervalJsonMap,
} from './crypto-algo-tunables.js';
import {
  parseCryptoAlgoStrategies,
  presentIntervalExitMapForApi,
  presentIntervalNumberMapForApi,
} from './risk-config-api.js';
import {
  parseCryptoAlgoStrategyParams,
  serializeCryptoAlgoStrategyParams,
  type CryptoAlgoStrategyParamsMap,
} from './crypto-algo-strategy-params.js';

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
