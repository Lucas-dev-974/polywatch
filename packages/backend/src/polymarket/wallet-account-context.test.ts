import { describe, expect, it } from 'vitest';
import type { WalletAccount } from '@polywatch/core';
import { resolveAccountWithdrawMode } from './wallet-account-context.js';

function account(overrides: Partial<WalletAccount> = {}): WalletAccount {
  return {
    id: 1,
    label: 'test',
    depositAddress: '0x1234567890123456789012345678901234567890',
    funderAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    signerPkEnc: null,
    signatureType: 1,
    isPrimary: true,
    sortOrder: 0,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('resolveAccountWithdrawMode', () => {
  it('detects deposit wallet mode when depot does not match proxy or safe', () => {
    const result = resolveAccountWithdrawMode(account());
    expect(result.isL2Deposit).toBe(true);
    expect(result.effectiveWithdrawMode).toBe('deposit');
    expect(result.signerAddress).toBe(account().funderAddress);
  });

  it('uses configured relayer mode when signer is unknown', () => {
    const result = resolveAccountWithdrawMode(
      account({ funderAddress: null, signatureType: 2 }),
    );
    expect(result.effectiveWithdrawMode).toBe('safe');
  });
});
