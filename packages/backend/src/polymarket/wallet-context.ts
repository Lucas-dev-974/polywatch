import { resolveWalletAddresses, type ClobCredentials } from '@polywatch/core';
import { resolveDepositForCredentials } from './deposit-wallet.js';
import { detectGammaProxyWallet, detectProxyWallet } from './proxy.js';

async function resolveDetectedProxy(
  walletAddress: string,
  funderAddress: string | null,
): Promise<string | null> {
  if (funderAddress) {
    const gammaProxy = await detectGammaProxyWallet(funderAddress);
    if (gammaProxy) return gammaProxy;
  }
  return detectProxyWallet(walletAddress);
}

export interface ResolvedWalletContext {
  depositAddress: string | null;
  eoaAddress: string | null;
  isL2Deposit: boolean;
  proxyDetectionMethod: ReturnType<typeof resolveWalletAddresses>['proxyDetectionMethod'];
}

export async function resolveWalletContext(
  creds: ClobCredentials | null | undefined,
): Promise<ResolvedWalletContext> {
  if (!creds) {
    return {
      depositAddress: null,
      eoaAddress: null,
      isL2Deposit: false,
      proxyDetectionMethod: null,
    };
  }

  const depositAddress = await resolveDepositForCredentials(
    creds.walletAddress,
    creds.funderAddress,
  );

  const wallet = creds.walletAddress;
  const funder = creds.funderAddress;
  const explicitL2 =
    !!wallet &&
    !!funder &&
    wallet.toLowerCase() !== funder.toLowerCase();

  const detectedProxy = explicitL2
    ? null
    : await resolveDetectedProxy(wallet, funder);

  const { eoaAddress, proxyDetectionMethod } = resolveWalletAddresses(
    creds.walletAddress,
    creds.funderAddress,
    detectedProxy,
  );

  const isL2Deposit =
    !!depositAddress &&
    !!eoaAddress &&
    depositAddress.toLowerCase() !== eoaAddress.toLowerCase();

  return { depositAddress, eoaAddress, isL2Deposit, proxyDetectionMethod };
}
