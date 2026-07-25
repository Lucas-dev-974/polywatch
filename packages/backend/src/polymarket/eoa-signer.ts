import { Wallet } from 'ethers';
import type { ClobCredentials } from '@polywatch/core';
import { decrypt } from '../crypto/encryption.js';
import { validatePrivateKey } from '../crypto/private-key.js';
import { createPolygonProvider } from './polygon.js';

export function createDepositSigner(
  creds: ClobCredentials,
  depositAddress: string,
): Wallet {
  if (!creds.signerPkEnc) throw new Error('signer_missing');

  const signer = new Wallet(
    validatePrivateKey(decrypt(creds.signerPkEnc)),
    createPolygonProvider(),
  );
  if (depositAddress.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error('eoa_deposit_mismatch');
  }
  return signer;
}
