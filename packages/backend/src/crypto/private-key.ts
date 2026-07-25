import { normalizePrivateKeyHex } from '@polywatch/core';
import { Wallet } from 'ethers';

/** Validates and returns a normalized 0x-prefixed secp256k1 private key. */
export function validatePrivateKey(raw: string): string {
  const pk = normalizePrivateKeyHex(raw);
  try {
    new Wallet(pk);
    return pk;
  } catch {
    throw new Error('invalid_signer_private_key');
  }
}

export function walletAddressFromPrivateKey(raw: string): string {
  return new Wallet(validatePrivateKey(raw)).address;
}
