/** Normalizes a secp256k1 private key to a lowercase 0x-prefixed hex string. */
export function normalizePrivateKeyHex(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(' ')) {
    throw new Error('invalid_signer_private_key');
  }
  const compact = trimmed.replace(/\s+/g, '');
  const hex = compact.startsWith('0x') ? compact.slice(2) : compact;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('invalid_signer_private_key');
  }
  return `0x${hex.toLowerCase()}`;
}
