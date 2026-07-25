import type { BuilderApiKeyCreds } from '@polymarket/builder-signing-sdk';
import type { ClobCredentials } from '@polywatch/core';
import { decrypt } from '../crypto/encryption.js';

export const DEFAULT_RELAYER_URL = 'https://relayer-v2.polymarket.com/';

export function hasBuilderCredentials(
  creds: Pick<
    ClobCredentials,
    'builderApiKeyEnc' | 'builderSecretEnc' | 'builderPassphraseEnc'
  > | null | undefined,
): boolean {
  return !!(
    creds?.builderApiKeyEnc &&
    creds?.builderSecretEnc &&
    creds?.builderPassphraseEnc
  );
}

export function getBuilderCreds(creds: ClobCredentials): BuilderApiKeyCreds | null {
  if (!hasBuilderCredentials(creds)) return null;
  return {
    key: decrypt(creds.builderApiKeyEnc!),
    secret: decrypt(creds.builderSecretEnc!),
    passphrase: decrypt(creds.builderPassphraseEnc!),
  };
}

export function normalizeRelayerUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function resolveRelayerUrl(creds: ClobCredentials): string {
  const raw = creds.relayerUrl?.trim() || DEFAULT_RELAYER_URL;
  return normalizeRelayerUrl(raw);
}
