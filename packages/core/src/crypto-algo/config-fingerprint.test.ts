import { describe, expect, it } from 'vitest';
import { computeCryptoAlgoConfigFingerprint } from './config-fingerprint.js';

describe('computeCryptoAlgoConfigFingerprint', () => {
  it('is stable for the same crypto_algo tunables', () => {
    const cfg = {
      cryptoAlgoEnabled: true,
      cryptoAlgoSlEnabled: true,
      cryptoAlgoSlBidPoints: 0.28,
      cryptoAlgoTrailingEnabled: false,
    };
    const a = computeCryptoAlgoConfigFingerprint(cfg);
    const b = computeCryptoAlgoConfigFingerprint({ ...cfg });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('changes when a tracked field changes', () => {
    const base = {
      cryptoAlgoSlBidPoints: 0.28,
      cryptoAlgoTrailingEnabled: false,
    };
    const a = computeCryptoAlgoConfigFingerprint(base);
    const b = computeCryptoAlgoConfigFingerprint({
      ...base,
      cryptoAlgoSlBidPoints: 0.32,
    });
    expect(a).not.toBe(b);
  });
});
