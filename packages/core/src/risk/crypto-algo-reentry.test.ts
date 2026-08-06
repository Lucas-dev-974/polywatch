import { describe, expect, it } from 'vitest';
import {
  CRYPTO_ALGO_DEFAULT_MAX_ENTRIES_PER_WINDOW,
  CRYPTO_ALGO_DEFAULT_REENTRY_WINDOW_MS,
  resolveCryptoAlgoReentryParams,
} from './crypto-algo-helpers.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';

function makeCrypto(overrides: Partial<CryptoConfig> = {}): CryptoConfig {
  return {
    cryptoAlgoReentryWindowMs: null,
    cryptoAlgoMaxEntriesPerWindow: null,
    ...overrides,
  } as CryptoConfig;
}

describe('resolveCryptoAlgoReentryParams', () => {
  it('uses interval duration when risk overrides are null', () => {
    expect(resolveCryptoAlgoReentryParams(makeCrypto(), '5m')).toEqual({
      windowMs: 5 * 60_000,
      maxEntries: CRYPTO_ALGO_DEFAULT_MAX_ENTRIES_PER_WINDOW,
    });
  });

  it('falls back to 1h when interval is unknown', () => {
    expect(resolveCryptoAlgoReentryParams(makeCrypto(), null)).toEqual({
      windowMs: CRYPTO_ALGO_DEFAULT_REENTRY_WINDOW_MS,
      maxEntries: 1,
    });
  });

  it('applies explicit risk overrides', () => {
    expect(
      resolveCryptoAlgoReentryParams(
        makeCrypto({
          cryptoAlgoReentryWindowMs: 120_000,
          cryptoAlgoMaxEntriesPerWindow: 3,
        }),
        '5m',
      ),
    ).toEqual({
      windowMs: 120_000,
      maxEntries: 3,
    });
  });
});
