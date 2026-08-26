import { describe, expect, it } from 'vitest';
import { computeCryptoAlgoConfigFingerprint } from './config-fingerprint.js';

describe('computeCryptoAlgoConfigFingerprint', () => {
  it('is stable for the same crypto_algo tunables', () => {
    const cfg = {
      cryptoAlgoEnabled: true,
      cryptoAlgoSlEnabled: true,
      cryptoAlgoSlPercent: 28,
      cryptoAlgoTrailingEnabled: false,
    };
    const a = computeCryptoAlgoConfigFingerprint(cfg);
    const b = computeCryptoAlgoConfigFingerprint({ ...cfg });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('changes when a tracked field changes', () => {
    const base = {
      cryptoAlgoSlPercent: 28,
      cryptoAlgoTrailingEnabled: false,
    };
    const a = computeCryptoAlgoConfigFingerprint(base);
    const b = computeCryptoAlgoConfigFingerprint({
      ...base,
      cryptoAlgoSlPercent: 32,
    });
    expect(a).not.toBe(b);
  });
});
