import { describe, expect, it } from 'vitest';
import {
  resolveDepositAddress,
  resolveWalletAddresses,
} from './trading-wallet.js';

describe('resolveWalletAddresses', () => {
  it('uses wallet as deposit when funder differs', () => {
    const result = resolveWalletAddresses(
      '0xDeposit',
      '0xEoa',
      null,
    );
    expect(result).toEqual({
      eoaAddress: '0xEoa',
      depositAddress: '0xDeposit',
      proxyDetectionMethod: 'configured',
    });
  });

  it('uses detected proxy when wallet equals funder', () => {
    const result = resolveWalletAddresses(
      '0xEoa',
      '0xEoa',
      '0xProxy',
    );
    expect(result.depositAddress).toBe('0xProxy');
    expect(result.proxyDetectionMethod).toBe('polyproxy');
  });

  it('returns null deposit when wallet is missing', () => {
    expect(resolveDepositAddress(null, '0xEoa', null)).toBeNull();
  });
});
