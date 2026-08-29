import { createHash } from 'node:crypto';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { OptimizeReportConfigInput } from './optimize-report.js';

/** Fields that affect crypto algo exit/entry behavior — used for apply guard. */
const CRYPTO_ALGO_FINGERPRINT_KEYS = [
  'cryptoAlgoEnabled',
  'cryptoAlgoStrategies',
  'cryptoAlgoSlEnabled',
  'cryptoAlgoTpEnabled',
  'cryptoAlgoTrailingEnabled',
  'cryptoAlgoSlPercent',
  'cryptoAlgoTpPercent',
  'cryptoAlgoTrailingPercent',
  'cryptoAlgoTrailingActivationPercent',
  'cryptoAlgoPreCloseEnabled',
  'cryptoAlgoPreCloseSeconds',
  'cryptoAlgoPreCloseKeepEnabled',
  'cryptoAlgoPreCloseKeepBidThreshold',
  'slConfirmationTicks',
  'cryptoAlgoBaseThreshold',
  'cryptoAlgoEntryPriceBandEnabled',
  'cryptoAlgoEntryPriceMin',
  'cryptoAlgoEntryPriceMax',
  'cryptoAlgoCurveFilterEnabled',
  'cryptoAlgoCurveLookbackMs',
  'cryptoAlgoCurveMinDelta',
  'cryptoAlgoSizingMode',
  'cryptoAlgoEntryPusdAmount',
  'cryptoAlgoEntryShareCount',
] as const;

type FingerprintSource = CryptoConfig | OptimizeReportConfigInput;

function pickFingerprintFields(source: FingerprintSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const record = source as unknown as Record<string, unknown>;
  for (const key of CRYPTO_ALGO_FINGERPRINT_KEYS) {
    out[key] = record[key] ?? null;
  }
  return out;
}

export function computeCryptoAlgoConfigFingerprint(source: FingerprintSource): string {
  const payload = JSON.stringify(pickFingerprintFields(source));
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
