import { resolveDepositAddress } from '@polywatch/core';
import { detectGammaProxyWallet, detectProxyWallet } from './proxy.js';

async function detectDepositProxy(
  walletAddress: string,
  funderAddress: string | null,
): Promise<string | null> {
  if (funderAddress) {
    try {
      const gammaProxy = await detectGammaProxyWallet(funderAddress);
      if (gammaProxy) return gammaProxy;
    } catch {
      // Gamma lookup failed
    }
  }

  try {
    const proxy = await detectProxyWallet(walletAddress);
    if (proxy) return proxy;
  } catch {
    // RPC or Gamma fallback failed
  }

  return null;
}

function isExplicitL2Deposit(
  walletAddress: string,
  funderAddress: string | null,
): boolean {
  if (!funderAddress) return false;
  return walletAddress.toLowerCase() !== funderAddress.toLowerCase();
}

export async function resolveDepositForCredentials(
  walletAddress: string | null,
  funderAddress: string | null,
): Promise<string | null> {
  if (!walletAddress) return null;

  // Configured depot (≠ funder): always trust the address from CLOB credentials.
  if (isExplicitL2Deposit(walletAddress, funderAddress)) {
    return walletAddress;
  }

  const detectedProxy = await detectDepositProxy(walletAddress, funderAddress);
  return resolveDepositAddress(walletAddress, funderAddress, detectedProxy);
}
