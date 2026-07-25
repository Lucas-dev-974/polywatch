import { describe, expect, it } from 'vitest';
import type { RiskConfig } from '../entities/RiskConfig.js';
import {
  presentRiskConfigForApi,
  toRiskConfigEntityUpdate,
} from './risk-config-api.js';

function baseConfig(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    id: 1,
    simAllowedMarketTags: '["sports"]',
    realAllowedMarketTags: '[]',
    ...overrides,
  } as RiskConfig;
}

describe('risk-config-api', () => {
  it('presents stored JSON tag lists as string arrays', () => {
    expect(presentRiskConfigForApi(baseConfig())).toMatchObject({
      simAllowedMarketTags: ['sports'],
      realAllowedMarketTags: [],
    });
  });

  it('serializes API tag arrays before persisting', () => {
    expect(
      toRiskConfigEntityUpdate({
        simAllowedMarketTags: ['crypto', 'sports'],
        realMaxOpenPositions: 5,
      }),
    ).toMatchObject({
      simAllowedMarketTags: '["crypto","sports"]',
      realMaxOpenPositions: 5,
    });
  });

  it('normalizes empty interval maps to null on GET (C7.2)', () => {
    const presented = presentRiskConfigForApi(
      baseConfig({
        cryptoAlgoSpreadAbsByInterval: '{}',
        cryptoAlgoPreCloseSecondsByInterval: null,
        cryptoAlgoExitDefaultsByInterval: '{}',
      }),
    );
    expect(presented.cryptoAlgoSpreadAbsByInterval).toBeNull();
    expect(presented.cryptoAlgoPreCloseSecondsByInterval).toBeNull();
    expect(presented.cryptoAlgoExitDefaultsByInterval).toBeNull();
  });

  it('preserves non-empty interval map overrides on GET', () => {
    const presented = presentRiskConfigForApi(
      baseConfig({
        cryptoAlgoSpreadAbsByInterval: '{"5m":0.08}',
      }),
    );
    expect(presented.cryptoAlgoSpreadAbsByInterval).toEqual({ '5m': 0.08 });
  });

  it('falls back to null on invalid interval JSON (C7.3)', () => {
    const presented = presentRiskConfigForApi(
      baseConfig({
        cryptoAlgoSpreadAbsByInterval: '{not-json',
      }),
    );
    expect(presented.cryptoAlgoSpreadAbsByInterval).toBeNull();
  });
});
