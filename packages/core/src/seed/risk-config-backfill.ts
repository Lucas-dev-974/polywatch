import type { RiskConfig } from '../entities/RiskConfig.js';

type LegacyBackfill = {
  simKey: keyof RiskConfig;
  realKey: keyof RiskConfig;
  legacyKey: keyof RiskConfig;
  defaultValue: RiskConfig[keyof RiskConfig];
  requireLegacyDiffers?: boolean;
};

const LEGACY_BACKFILLS: LegacyBackfill[] = [
  {
    simKey: 'simMaxPositionSizeUsdc',
    realKey: 'realMaxPositionSizeUsdc',
    legacyKey: 'maxPositionSizeUsdc',
    defaultValue: 200,
  },
  {
    simKey: 'simMaxExposureUsdc',
    realKey: 'realMaxExposureUsdc',
    legacyKey: 'maxExposureUsdc',
    defaultValue: 1000,
  },
  {
    simKey: 'simMaxDailyLossUsdc',
    realKey: 'realMaxDailyLossUsdc',
    legacyKey: 'maxDailyLossUsdc',
    defaultValue: 100,
  },
  {
    simKey: 'simKillSwitchAction',
    realKey: 'realKillSwitchAction',
    legacyKey: 'killSwitchAction',
    defaultValue: 'block_entries',
    requireLegacyDiffers: true,
  },
  {
    simKey: 'simCopyIncreaseEnabled',
    realKey: 'realCopyIncreaseEnabled',
    legacyKey: 'copyIncreaseEnabled',
    defaultValue: true,
    requireLegacyDiffers: true,
  },
  {
    simKey: 'simCopyDecreaseEnabled',
    realKey: 'realCopyDecreaseEnabled',
    legacyKey: 'copyDecreaseEnabled',
    defaultValue: true,
    requireLegacyDiffers: true,
  },
  {
    simKey: 'simMaxIncreasesPerPosition',
    realKey: 'realMaxIncreasesPerPosition',
    legacyKey: 'maxIncreasesPerPosition',
    defaultValue: 0,
    requireLegacyDiffers: true,
  },
  {
    simKey: 'simPreCloseEnabled',
    realKey: 'realPreCloseEnabled',
    legacyKey: 'preCloseEnabled',
    defaultValue: true,
    requireLegacyDiffers: true,
  },
  {
    simKey: 'simPreCloseSeconds',
    realKey: 'realPreCloseSeconds',
    legacyKey: 'preCloseSeconds',
    defaultValue: 60,
    requireLegacyDiffers: true,
  },
];

function backfillModePair(
  config: RiskConfig,
  entry: LegacyBackfill,
): boolean {
  const { simKey, realKey, legacyKey, defaultValue, requireLegacyDiffers } =
    entry;

  if (config[simKey] !== defaultValue || config[realKey] !== defaultValue) {
    return false;
  }
  if (requireLegacyDiffers && config[legacyKey] === defaultValue) {
    return false;
  }

  const legacyValue = config[legacyKey];
  if (
    config[simKey] === legacyValue &&
    config[realKey] === legacyValue
  ) {
    return false;
  }

  (config[simKey] as RiskConfig[typeof simKey]) = legacyValue as never;
  (config[realKey] as RiskConfig[typeof realKey]) = legacyValue as never;
  return true;
}

export function backfillLegacyRiskConfig(config: RiskConfig): boolean {
  let changed = false;
  for (const entry of LEGACY_BACKFILLS) {
    if (backfillModePair(config, entry)) {
      changed = true;
    }
  }
  return changed;
}
