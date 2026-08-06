import { describe, expect, it } from 'vitest';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  presentCryptoConfigForApi,
  toCryptoConfigEntityUpdate,
} from './crypto-config-api.js';

function baseConfig(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    id: 1,
    cryptoAlgoStrategies: '["naive-momentum"]',
    cryptoAlgoStrategyParams: '{}',
    cryptoAlgoAllowedMarketTags: '["crypto"]',
    cryptoAlgoSpreadAbsByInterval: null,
    cryptoAlgoExitDefaultsByInterval: null,
    cryptoAlgoPreCloseSecondsByInterval: null,
    ...overrides,
  } as CryptoConfig;
}

describe('crypto-config-api', () => {
  it('presents stored JSON lists/maps as API arrays/objects', () => {
    expect(
      presentCryptoConfigForApi(
        baseConfig({
          cryptoAlgoSpreadAbsByInterval: '{"5m":0.08}',
        }),
      ),
    ).toMatchObject({
      cryptoAlgoStrategies: ['naive-momentum'],
      cryptoAlgoAllowedMarketTags: ['crypto'],
      cryptoAlgoSpreadAbsByInterval: { '5m': 0.08 },
    });
  });

  it('serializes API arrays/maps before persisting', () => {
    expect(
      toCryptoConfigEntityUpdate({
        cryptoAlgoEnabled: false,
        cryptoAlgoStrategies: ['naive-momentum'],
        cryptoAlgoAllowedMarketTags: ['crypto', 'sports'],
        cryptoAlgoSpreadAbsByInterval: { '5m': 0.05 },
      }),
    ).toMatchObject({
      cryptoAlgoEnabled: false,
      cryptoAlgoStrategies: '["naive-momentum"]',
      cryptoAlgoAllowedMarketTags: '["crypto","sports"]',
      cryptoAlgoSpreadAbsByInterval: '{"5m":0.05}',
    });
  });

  it('normalizes empty interval maps to null on GET', () => {
    const presented = presentCryptoConfigForApi(
      baseConfig({
        cryptoAlgoSpreadAbsByInterval: '{}',
        cryptoAlgoExitDefaultsByInterval: '{}',
      }),
    );
    expect(presented.cryptoAlgoSpreadAbsByInterval).toBeNull();
    expect(presented.cryptoAlgoExitDefaultsByInterval).toBeNull();
  });

  it('falls back to empty strategies on invalid JSON', () => {
    expect(
      presentCryptoConfigForApi(
        baseConfig({ cryptoAlgoStrategies: '{not-json' }),
      ).cryptoAlgoStrategies,
    ).toEqual([]);
  });
});
