import type { DataSource } from '@polywatch/core';
import { RiskConfig } from '@polywatch/core';

/**
 * Configure RiskConfig for crypto-algo e2e tests:
 * - algo enabled
 * - naive-momentum strategy enabled
 * - sim mode enabled with enough cash for entries
 * - SL / TP / trailing / pre-close parameters set
 */
export async function configureCryptoAlgoRisk(
  ds: DataSource,
  overrides?: Partial<RiskConfig>,
): Promise<RiskConfig> {
  const repo = ds.getRepository(RiskConfig);
  const existing = (await repo.findOne({ where: {} })) ?? repo.create({});

  existing.cryptoAlgoEnabled = true;
  existing.cryptoAlgoStrategies = JSON.stringify(['naive-momentum']);
  existing.simSlPercent = 5;
  existing.simTpPercent = 15;
  existing.simTrailingEnabled = true;
  existing.simTrailingStopPercent = 10;
  existing.simTrailingActivationPercent = 0;
  existing.simPreCloseEnabled = true;
  existing.simPreCloseSeconds = 60;
  existing.simPreCloseKeepEnabled = false;
  existing.cryptoAlgoTimeExitEnabled = true;
  existing.cryptoAlgoTimeExitWinConfidenceBid = 0.95;
  existing.simInitialCapital = 10_000;
  existing.simMaxPositionSizeUsdc = 200;
  existing.simMaxExposureUsdc = 1_000;
  existing.simMaxOpenPositions = 10;
  existing.simEntryUsdcAmount = 50;
  existing.simEntryShareCount = 5;
  existing.simSizingMode = 'fixed_usdc';

  Object.assign(existing, overrides ?? {});

  return repo.save(existing);
}
