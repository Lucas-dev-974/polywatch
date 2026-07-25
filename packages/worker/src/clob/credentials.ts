import { config } from '../config.js';
import type {
  InternalClobCredentialsResponse,
  PlainApiClobCredentials,
} from './types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchInternalClobCredentials(
  attempts = 30,
  delayMs = 1000,
): Promise<InternalClobCredentialsResponse | null> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${config.backendUrl}/api/internal/clob-credentials`, {
        headers: { 'x-service-token': config.serviceToken },
      });
      if (res.ok) {
        return res.json() as Promise<InternalClobCredentialsResponse>;
      }
      if (res.status >= 500) {
        lastError = new Error(`server error ${res.status}`);
        await sleep(delayMs);
        continue;
      }
      return null;
    } catch (err) {
      lastError = err;
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error('failed to fetch clob credentials');
}

export function parseApiClobCredentials(
  data: InternalClobCredentialsResponse,
): PlainApiClobCredentials | null {
  if (
    !data.apiKey ||
    !data.secret ||
    !data.passphrase ||
    !data.signerPrivateKey
  ) {
    return null;
  }

  return {
    apiKey: data.apiKey,
    secret: data.secret,
    passphrase: data.passphrase,
    signerPrivateKey: data.signerPrivateKey,
  };
}
