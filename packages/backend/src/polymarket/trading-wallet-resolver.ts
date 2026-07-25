import type { DataSource } from 'typeorm';
import { ClobCredentials } from '@polywatch/core';
import { decrypt } from '../crypto/encryption.js';
import {
  getPrimaryWalletAccount,
  mergeWithdrawCredentials,
} from './wallet-accounts.js';
import { resolveDepositForCredentials } from './deposit-wallet.js';

export interface TradingWalletContext {
  creds: ClobCredentials;
  merged: ClobCredentials;
  depositAddress: string | null;
}

export async function resolveTradingWalletContext(
  ds: DataSource,
): Promise<TradingWalletContext | null> {
  const creds = await ds.getRepository(ClobCredentials).findOne({ where: {} });
  if (!creds) return null;

  const primary = await getPrimaryWalletAccount(ds);
  const merged = primary ? mergeWithdrawCredentials(creds, primary) : creds;
  const depositAddress = await resolveDepositForCredentials(
    merged.walletAddress,
    merged.funderAddress,
  );

  return { creds, merged, depositAddress };
}

export function decryptClobCredentials(
  creds: ClobCredentials,
  merged: ClobCredentials,
) {
  return {
    walletAddress: merged.walletAddress,
    apiKey: creds.apiKeyEnc ? decrypt(creds.apiKeyEnc) : null,
    secret: creds.secretEnc ? decrypt(creds.secretEnc) : null,
    passphrase: creds.passphraseEnc ? decrypt(creds.passphraseEnc) : null,
    signerPrivateKey: merged.signerPkEnc ? decrypt(merged.signerPkEnc) : null,
    signatureType: merged.signatureType,
    funderAddress: merged.funderAddress,
  };
}
