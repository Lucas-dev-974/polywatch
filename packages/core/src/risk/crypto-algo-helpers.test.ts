import { describe, expect, it } from 'vitest';
import type { RiskConfig } from '../entities/RiskConfig.js';
import {
  getCryptoAlgoEffectivePreCloseSeconds,
  getPositionPreCloseParams,
  isAlgoPositionReason,
  isCryptoAlgoPreCloseEnabled,
} from './crypto-algo-helpers.js';

function makeRisk(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    simPreCloseEnabled: true,
    simPreCloseSeconds: 60,
    simPreCloseKeepEnabled: false,
    simPreCloseKeepBidThreshold: 0.80,
    realPreCloseEnabled: false,
    realPreCloseSeconds: 120,
    realPreCloseKeepEnabled: false,
    realPreCloseKeepBidThreshold: 0.80,
    cryptoAlgoPreCloseEnabled: null,
    cryptoAlgoPreCloseSeconds: null,
    cryptoAlgoPreCloseKeepEnabled: null,
    cryptoAlgoPreCloseKeepBidThreshold: null,
    ...overrides,
  } as RiskConfig;
}

describe('crypto-algo pre-close helpers', () => {
  it('detects algo position reasons', () => {
    expect(isAlgoPositionReason('ALGO_OPEN')).toBe(true);
    expect(isAlgoPositionReason('COPY_OPEN')).toBe(false);
  });

  it('uses algo pre-close defaults when overrides are null', () => {
    const risk = makeRisk();
    expect(getPositionPreCloseParams(risk, 'sim', 'ALGO_OPEN')).toEqual({
      preCloseEnabled: true,
      preCloseSeconds: 60,
      keepEnabled: false,
      keepBidThreshold: 0.80,
    });
  });

  it('applies crypto-algo overrides for algo positions', () => {
    const risk = makeRisk({
      cryptoAlgoPreCloseEnabled: true,
      cryptoAlgoPreCloseSeconds: 30,
      cryptoAlgoPreCloseKeepEnabled: true,
      cryptoAlgoPreCloseKeepBidThreshold: 0.85,
    });
    expect(getPositionPreCloseParams(risk, 'sim', 'ALGO_OPEN')).toEqual({
      preCloseEnabled: true,
      preCloseSeconds: 30,
      keepEnabled: true,
      keepBidThreshold: 0.85,
    });
  });

  it('can disable pre-close for algo while copy keeps it', () => {
    const risk = makeRisk({ cryptoAlgoPreCloseEnabled: false });
    expect(getPositionPreCloseParams(risk, 'sim', 'ALGO_OPEN').preCloseEnabled).toBe(
      false,
    );
    expect(getPositionPreCloseParams(risk, 'sim', 'COPY_OPEN').preCloseEnabled).toBe(
      true,
    );
  });

  it('reports crypto-algo pre-close enabled state', () => {
    expect(isCryptoAlgoPreCloseEnabled(makeRisk())).toBe(true);
    expect(
      isCryptoAlgoPreCloseEnabled(
        makeRisk({
          simPreCloseEnabled: false,
          cryptoAlgoPreCloseEnabled: true,
        }),
      ),
    ).toBe(true);
    expect(
      isCryptoAlgoPreCloseEnabled(
        makeRisk({
          simPreCloseEnabled: false,
          realPreCloseEnabled: false,
          cryptoAlgoPreCloseEnabled: false,
        }),
      ),
    ).toBe(false);
  });

  it('resolves effective pre-close seconds for market refresh', () => {
    expect(getCryptoAlgoEffectivePreCloseSeconds(makeRisk())).toBe(60);
    expect(
      getCryptoAlgoEffectivePreCloseSeconds(
        makeRisk({ cryptoAlgoPreCloseSeconds: 45 }),
      ),
    ).toBe(45);
    expect(
      getCryptoAlgoEffectivePreCloseSeconds(
        makeRisk({ cryptoAlgoPreCloseEnabled: false }),
      ),
    ).toBe(0);
  });
});
