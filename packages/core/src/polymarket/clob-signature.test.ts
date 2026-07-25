import { describe, expect, it } from 'vitest';
import {
  CLOB_SIGNATURE_POLY_1271,
  isDepositWalletSignatureType,
  resolveClobSignatureType,
} from './clob-signature.js';

describe('resolveClobSignatureType', () => {
  it('defaults to POLY_1271 when unset', () => {
    expect(resolveClobSignatureType()).toBe(CLOB_SIGNATURE_POLY_1271);
    expect(resolveClobSignatureType(null)).toBe(CLOB_SIGNATURE_POLY_1271);
  });

  it('keeps explicit valid values', () => {
    expect(resolveClobSignatureType(0)).toBe(0);
    expect(resolveClobSignatureType(1)).toBe(1);
    expect(resolveClobSignatureType(2)).toBe(2);
    expect(resolveClobSignatureType(3)).toBe(3);
  });

  it('falls back to POLY_1271 for invalid values', () => {
    expect(resolveClobSignatureType(99)).toBe(CLOB_SIGNATURE_POLY_1271);
    expect(resolveClobSignatureType(-1)).toBe(CLOB_SIGNATURE_POLY_1271);
  });
});

describe('isDepositWalletSignatureType', () => {
  it('only accepts POLY_1271', () => {
    expect(isDepositWalletSignatureType(3)).toBe(true);
    expect(isDepositWalletSignatureType(0)).toBe(false);
  });
});
