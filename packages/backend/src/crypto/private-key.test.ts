import { Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import { validatePrivateKey, walletAddressFromPrivateKey } from './private-key.js';

const TEST_PK = Wallet.createRandom().privateKey;

describe('validatePrivateKey', () => {
  it('accepts 0x-prefixed keys', () => {
    expect(validatePrivateKey(TEST_PK)).toBe(TEST_PK.toLowerCase());
  });

  it('accepts keys without 0x prefix', () => {
    expect(validatePrivateKey(TEST_PK.slice(2))).toBe(TEST_PK.toLowerCase());
  });

  it('rejects invalid keys', () => {
    expect(() => validatePrivateKey('not-a-key')).toThrow('invalid_signer_private_key');
    expect(() => validatePrivateKey('0x1234')).toThrow('invalid_signer_private_key');
    expect(() => validatePrivateKey('word '.repeat(12))).toThrow('invalid_signer_private_key');
  });

  it('derives wallet address', () => {
    expect(walletAddressFromPrivateKey(TEST_PK)).toBe(
      new Wallet(TEST_PK).address,
    );
  });
});
