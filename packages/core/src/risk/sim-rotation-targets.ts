import type { RiskConfig } from '../entities/RiskConfig.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';
import {
  CRYPTO_ALGO_SNAPSHOT_KEYS,
  pickRotationKeys,
  SIM_SESSION_ROTATION_KEYS,
} from './sim-mode-fields.js';

/** Copy-trading sim keys that trigger rotation of the copy algo only. */
const COPY_SIM_ROTATION_KEYS = SIM_SESSION_ROTATION_KEYS.filter(
  (key) =>
    key.startsWith('sim') &&
    key !== 'simInitialCapital' &&
    key !== 'simInitialCapitalCrypto' &&
    key !== 'simInitialCapitalWeather' &&
    key !== 'simInitialCapitalCopy',
) as readonly (keyof RiskConfig)[];

const CRYPTO_ROTATION_KEYS = SIM_SESSION_ROTATION_KEYS.filter((key) =>
  (CRYPTO_ALGO_SNAPSHOT_KEYS as readonly string[]).includes(key as string),
) as readonly (keyof RiskConfig)[];

/** Weather algo keys that trigger rotation of the weather algo only. */
export const WEATHER_SESSION_ROTATION_KEYS = [
  'weatherAlgoEnabled',
  'weatherAlgoSimEnabled',
  'weatherAlgoRealEnabled',
  'weatherAlgoMinEdge',
  'weatherAlgoMaxForecastStd',
  'weatherAlgoSizingMode',
  'weatherAlgoEntryUsdc',
  'weatherAlgoSelectionMode',
  'weatherAlgoMaxSignalsPerEvent',
  'weatherAlgoForecastChangeThreshold',
  'weatherAlgoCloseBeforeResolutionHours',
  'weatherAlgoPollMs',
  'weatherAlgoCityFollowSwitchMode',
] as const satisfies readonly (keyof RiskConfig)[];

function keysChanged(
  before: RiskConfig,
  after: RiskConfig,
  keys: readonly (keyof RiskConfig)[],
): boolean {
  return pickRotationKeys(before, keys) !== pickRotationKeys(after, keys);
}

/**
 * Determine which algoKind sessions must hard-rotate after a risk-config PUT.
 * Never returns all 3 unless multiple independent groups changed.
 */
export function resolveSimRotationTargets(
  before: RiskConfig,
  after: RiskConfig,
): SimAlgoKind[] {
  const targets = new Set<SimAlgoKind>();

  if (before.simInitialCapitalCrypto !== after.simInitialCapitalCrypto) {
    targets.add('crypto');
  }
  if (before.simInitialCapitalWeather !== after.simInitialCapitalWeather) {
    targets.add('weather');
  }
  if (before.simInitialCapitalCopy !== after.simInitialCapitalCopy) {
    targets.add('copy');
  }
  // Legacy field: treat as crypto-only when per-kind fields unchanged.
  if (
    before.simInitialCapital !== after.simInitialCapital &&
    before.simInitialCapitalCrypto === after.simInitialCapitalCrypto
  ) {
    targets.add('crypto');
  }

  if (keysChanged(before, after, COPY_SIM_ROTATION_KEYS)) {
    targets.add('copy');
  }
  if (keysChanged(before, after, CRYPTO_ROTATION_KEYS)) {
    targets.add('crypto');
  }
  if (keysChanged(before, after, WEATHER_SESSION_ROTATION_KEYS)) {
    targets.add('weather');
  }

  return [...targets];
}

export function simRotationChanged(
  before: RiskConfig,
  after: RiskConfig,
): boolean {
  return resolveSimRotationTargets(before, after).length > 0;
}
