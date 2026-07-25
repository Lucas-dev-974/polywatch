import { Wallet } from 'ethers';

/** Derives EOA address from a pasted private key, or null if invalid. */
export function tryDeriveAddressFromPrivateKey(raw: string): string | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes(' ')) return null;
    const compact = trimmed.replace(/\s+/g, '');
    const hex = compact.startsWith('0x') ? compact.slice(2) : compact;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
    return new Wallet(`0x${hex.toLowerCase()}`).address.toLowerCase();
  } catch {
    return null;
  }
}
