import { describe, expect, it } from 'vitest';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  getStrategyParams,
  parseCryptoAlgoStrategyParams,
  resolveStrategyMinTimeToClose,
} from './crypto-algo-strategy-params.js';

function makeRisk(partial: Partial<CryptoConfig>): CryptoConfig {
  return partial as CryptoConfig;
}

describe('parseCryptoAlgoStrategyParams', () => {
  it('returns empty map for blank / invalid JSON', () => {
    expect(parseCryptoAlgoStrategyParams(null)).toEqual({});
    expect(parseCryptoAlgoStrategyParams('')).toEqual({});
    expect(parseCryptoAlgoStrategyParams('not-json')).toEqual({});
    expect(parseCryptoAlgoStrategyParams('[]')).toEqual({});
  });

  it('parses a strategy bag', () => {
    expect(
      parseCryptoAlgoStrategyParams(
        JSON.stringify({ s1_fair_value: { minTimeToClose: 30 } }),
      ),
    ).toEqual({ s1_fair_value: { minTimeToClose: 30 } });
  });
});

describe('resolveStrategyMinTimeToClose', () => {
  it('returns only the strategy-bag override', () => {
    const risk = makeRisk({
      cryptoAlgoMinTimeToClose: 200,
      cryptoAlgoStrategyParams: JSON.stringify({
        s1_fair_value: { minTimeToClose: 30 },
      }),
    });
    expect(resolveStrategyMinTimeToClose(risk, 's1_fair_value')).toBe(30);
  });

  it('returns null when bag has no override (caller chains global)', () => {
    const risk = makeRisk({
      cryptoAlgoMinTimeToClose: 200,
      cryptoAlgoStrategyParams: '{}',
    });
    expect(resolveStrategyMinTimeToClose(risk, 'naive_momentum')).toBeNull();
    expect(getStrategyParams(risk, 'naive_momentum')).toEqual({});
  });

  it('allows explicit 0 (skip gate)', () => {
    const risk = makeRisk({
      cryptoAlgoMinTimeToClose: 200,
      cryptoAlgoStrategyParams: JSON.stringify({
        s1_fair_value: { minTimeToClose: 0 },
      }),
    });
    expect(resolveStrategyMinTimeToClose(risk, 's1_fair_value')).toBe(0);
  });
});
