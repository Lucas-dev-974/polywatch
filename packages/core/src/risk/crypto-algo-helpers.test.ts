import { describe, expect, it } from 'vitest';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import {
  getCryptoAlgoEffectivePreCloseSeconds,
  getPositionPreCloseParams,
  isAlgoPositionReason,
  isCryptoAlgoPreCloseEnabled,
} from './crypto-algo-helpers.js';

function makeCrypto(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoPreCloseEnabled: null,
    cryptoAlgoPreCloseSeconds: null,
    cryptoAlgoPreCloseKeepEnabled: null,
    cryptoAlgoPreCloseKeepBidThreshold: null,
    ...overrides,
  } as CryptoConfig;
}

function makeCopy(overrides: Partial<CopyConfig> = {}): CopyConfig {
  return {
    simPreCloseEnabled: true,
    simPreCloseSeconds: 60,
    simPreCloseKeepEnabled: false,
    simPreCloseKeepBidThreshold: 0.80,
    realPreCloseEnabled: false,
    realPreCloseSeconds: 120,
    realPreCloseKeepEnabled: false,
    realPreCloseKeepBidThreshold: 0.80,
    ...overrides,
  } as CopyConfig;
}

describe('crypto-algo pre-close helpers', () => {
  it('detects algo position reasons', () => {
    expect(isAlgoPositionReason('ALGO_OPEN')).toBe(true);
    expect(isAlgoPositionReason('COPY_OPEN')).toBe(false);
  });

  it('fail-closes algo pre-close when overrides are null', () => {
    const crypto = makeCrypto();
    expect(getPositionPreCloseParams(crypto, 'sim', 'ALGO_OPEN')).toEqual({
      preCloseEnabled: false,
      preCloseSeconds: 0,
      keepEnabled: false,
      keepBidThreshold: 0.80,
    });
  });

  it('applies crypto-algo overrides for algo positions', () => {
    const crypto = makeCrypto({
      cryptoAlgoPreCloseEnabled: true,
      cryptoAlgoPreCloseSeconds: 30,
      cryptoAlgoPreCloseKeepEnabled: true,
      cryptoAlgoPreCloseKeepBidThreshold: 0.85,
    });
    expect(getPositionPreCloseParams(crypto, 'sim', 'ALGO_OPEN')).toEqual({
      preCloseEnabled: true,
      preCloseSeconds: 30,
      keepEnabled: true,
      keepBidThreshold: 0.85,
    });
  });

  it('uses copy pre-close for copy positions independently of crypto config', () => {
    const copy = makeCopy();
    expect(getPositionPreCloseParams(copy, 'sim', 'COPY_OPEN')).toEqual({
      preCloseEnabled: true,
      preCloseSeconds: 60,
      keepEnabled: false,
      keepBidThreshold: 0.80,
    });

    const cryptoDisabled = makeCrypto({ cryptoAlgoPreCloseEnabled: false });
    expect(
      getPositionPreCloseParams(cryptoDisabled, 'sim', 'ALGO_OPEN').preCloseEnabled,
    ).toBe(false);
  });

  it('reports crypto-algo pre-close enabled only when explicitly true', () => {
    expect(isCryptoAlgoPreCloseEnabled(makeCrypto())).toBe(false);
    expect(
      isCryptoAlgoPreCloseEnabled(makeCrypto({ cryptoAlgoPreCloseEnabled: true })),
    ).toBe(true);
    expect(
      isCryptoAlgoPreCloseEnabled(makeCrypto({ cryptoAlgoPreCloseEnabled: false })),
    ).toBe(false);
  });

  it('resolves effective pre-close seconds for market refresh', () => {
    expect(getCryptoAlgoEffectivePreCloseSeconds(makeCrypto())).toBe(0);
    expect(
      getCryptoAlgoEffectivePreCloseSeconds(
        makeCrypto({ cryptoAlgoPreCloseSeconds: 45 }),
      ),
    ).toBe(45);
    // Disabled sells still keep an explicit seconds override for refresh/entry.
    expect(
      getCryptoAlgoEffectivePreCloseSeconds(
        makeCrypto({
          cryptoAlgoPreCloseEnabled: false,
          cryptoAlgoPreCloseSeconds: 45,
        }),
      ),
    ).toBe(45);
  });
});
