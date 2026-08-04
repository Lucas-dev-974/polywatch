import type { CryptoConfig, GlobalConfig } from '@polywatch/core';

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
