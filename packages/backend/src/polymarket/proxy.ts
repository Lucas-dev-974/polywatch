import { config } from '../config.js';

export async function detectGammaProxyWallet(eoa: string): Promise<string | null> {
  const url = `${config.gammaApi}/public-profile?address=${encodeURIComponent(eoa)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json() as { proxyWallet?: string };
  const proxy = data.proxyWallet?.toLowerCase();
  if (!proxy || proxy === eoa.toLowerCase()) return null;
  return data.proxyWallet!;
}

/**
 * Detect the Gnosis Safe proxy wallet for a given EOA.
 * Uses the Gamma API (fallback only, no V1 RPC).
 */
export async function detectProxyWallet(eoa: string): Promise<string | null> {
  try {
    return await detectGammaProxyWallet(eoa);
  } catch {
    return null;
  }
}