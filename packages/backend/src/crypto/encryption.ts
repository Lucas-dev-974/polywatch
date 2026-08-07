import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import pino from 'pino';

const log = pino({ name: 'encryption' });
const ALGO = 'aes-256-gcm';

let legacyKeyWarned = false;

/**
 * Accepts both key formats:
 * - 64 hex chars (npm run generate-secrets → 32 random bytes, recommended);
 * - 32 raw chars interpreted as UTF-8 (legacy / dev default).
 * A 64-hex string previously threw (64 utf8 bytes), so decoding it as hex
 * cannot break any existing installation.
 */
function getKey(): Buffer {
  const raw = config.masterEncryptionKey;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const key = Buffer.from(raw, 'utf8');
  if (key.length !== 32) {
    throw new Error(
      'MASTER_ENCRYPTION_KEY must be 64 hex chars (npm run generate-secrets) or exactly 32 bytes',
    );
  }
  if (!legacyKeyWarned) {
    legacyKeyWarned = true;
    log.warn(
      'MASTER_ENCRYPTION_KEY uses legacy 32-char UTF-8 format without KDF — prefer 64 hex chars from `npm run generate-secrets`',
    );
  }
  return key;
}

/** Call once at backend boot to surface legacy-key warning early. */
export function warnIfLegacyMasterEncryptionKey(): void {
  getKey();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
