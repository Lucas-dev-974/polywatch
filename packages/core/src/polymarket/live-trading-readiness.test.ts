import { describe, expect, it } from 'vitest';
import { evaluateLiveTradingReadiness } from './live-trading-readiness.js';

describe('evaluateLiveTradingReadiness', () => {
  const readyBase = {
    hasClobCredentials: true,
    hasApiKey: true,
    hasSecret: true,
    hasPassphrase: true,
    hasSignerPk: true,
    signatureType: 3,
    depositAddress: '0xabc',
  };

  it('returns liveReady when deposit wallet is configured', () => {
    expect(evaluateLiveTradingReadiness(readyBase)).toMatchObject({
      liveReady: true,
      blockReason: null,
    });
  });

  it('blocks when credentials are missing', () => {
    expect(
      evaluateLiveTradingReadiness({ ...readyBase, hasClobCredentials: false }),
    ).toMatchObject({
      liveReady: false,
      blockReason: 'clob_credentials_not_found',
    });
  });

  it('blocks when L2 fields are incomplete', () => {
    expect(
      evaluateLiveTradingReadiness({ ...readyBase, hasApiKey: false }),
    ).toMatchObject({
      liveReady: false,
      blockReason: 'clob_credentials_incomplete',
    });
  });

  it('blocks when signature type is not deposit wallet (3)', () => {
    expect(
      evaluateLiveTradingReadiness({ ...readyBase, signatureType: 0 }),
    ).toMatchObject({
      liveReady: false,
      blockReason: 'invalid_signature_type',
    });
  });

  it('blocks when deposit address is missing', () => {
    expect(
      evaluateLiveTradingReadiness({ ...readyBase, depositAddress: null }),
    ).toMatchObject({
      liveReady: false,
      blockReason: 'no_deposit_address',
    });
  });
});
