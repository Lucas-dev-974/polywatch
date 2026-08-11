import type { CryptoConfig, GlobalConfig, WeatherConfig } from '@polywatch/core';

/** Minimal GlobalConfig for strategy/executor unit tests. */
export function makeGlobalConfig(
  overrides: Partial<GlobalConfig> = {},
): GlobalConfig {
  return {
    realTradingEnabled: true,
    simExecLatencyMode: 'fixed',
    simExecLatencyMs: 0,
    simSelfImpactEnabled: true,
    simSelfImpactTtlSeconds: 8,
    simWalletPreflightEnabled: false,
    simShadowLoggingEnabled: false,
    ...overrides,
  } as GlobalConfig;
}

/**
 * Minimal CryptoConfig for exit-eval tests.
 * Default positions without a COPY_/WEATHER_ reason resolve as crypto via getAlgoKindForPosition.
 */
export function makeCryptoConfig(
  overrides: Partial<CryptoConfig> = {},
): CryptoConfig {
  return {
    cryptoAlgoSlConfirmationTicks: 1,
    cryptoAlgoSlCloseMaxRetries: 5,
    cryptoAlgoPreCloseEnabled: false,
    cryptoAlgoPreCloseSeconds: 0,
    cryptoAlgoPreCloseKeepEnabled: false,
    cryptoAlgoPreCloseKeepBidThreshold: 0,
    ...overrides,
  } as CryptoConfig;
}

/**
 * Minimal WeatherConfig for exit-eval tests. Per-strategy params are resolved
 * from the bag (catalogue defaults + stored overrides), so the fixture only
 * needs the strategy params column.
 */
export function makeWeatherConfig(
  overrides: Partial<WeatherConfig> = {},
): WeatherConfig {
  return {
    weatherAlgoStrategyParams: JSON.stringify({
      'weather-forecast': { slConfirmationTicks: 2, slCloseMaxRetries: 5 },
    }),
    ...overrides,
  } as WeatherConfig;
}
