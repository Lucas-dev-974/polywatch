import {
  ClobCredentials,
  evaluateLiveTradingReadiness,
  type LiveTradingReadiness,
} from '@polywatch/core';
import type { DataSource } from 'typeorm';
import { resolveDepositForCredentials } from './deposit-wallet.js';
import { getPrimaryWalletAccount, mergeWithdrawCredentials } from './wallet-accounts.js';

export async function evaluateStoredClobReadiness(
  ds: DataSource,
): Promise<LiveTradingReadiness & { configured: boolean }> {
  const creds = await ds.getRepository(ClobCredentials).findOne({ where: {} });
  if (!creds) {
    return {
      configured: false,
      ...evaluateLiveTradingReadiness({
        hasClobCredentials: false,
        hasApiKey: false,
        hasSecret: false,
        hasPassphrase: false,
        hasSignerPk: false,
        signatureType: null,
        depositAddress: null,
      }),
    };
  }

  const primary = await getPrimaryWalletAccount(ds);
  const merged = primary ? mergeWithdrawCredentials(creds, primary) : creds;
  const depositAddress = await resolveDepositForCredentials(
    merged.walletAddress,
    merged.funderAddress,
  );

  return {
    configured: true,
    ...evaluateLiveTradingReadiness({
      hasClobCredentials: true,
      hasApiKey: !!creds.apiKeyEnc,
      hasSecret: !!creds.secretEnc,
      hasPassphrase: !!creds.passphraseEnc,
      hasSignerPk: !!(merged.signerPkEnc ?? creds.signerPkEnc),
      signatureType: merged.signatureType,
      depositAddress,
    }),
  };
}
