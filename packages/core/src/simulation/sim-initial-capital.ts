import type { DataSource } from 'typeorm';
import type { RiskConfig } from '../entities/RiskConfig.js';
import type { SimAlgoKind } from './algo-kind.js';
import { CryptoConfigService } from '../services/crypto-config.service.js';
import { WeatherConfigService } from '../services/weather-config.service.js';
import { CopyConfigService } from '../services/copy-config.service.js';
import { DEFAULT_SIM_BALANCE } from './constants.js';

export type SimInitialCapitalRisk = Pick<
  RiskConfig,
  | 'simInitialCapitalCrypto'
  | 'simInitialCapitalWeather'
  | 'simInitialCapitalCopy'
>;

export function getSimInitialCapital(
  risk: Partial<SimInitialCapitalRisk> | null | undefined,
  algoKind: SimAlgoKind,
): number {
  if (!risk) return DEFAULT_SIM_BALANCE;
  switch (algoKind) {
    case 'weather':
      return risk.simInitialCapitalWeather ?? DEFAULT_SIM_BALANCE;
    case 'copy':
      return risk.simInitialCapitalCopy ?? DEFAULT_SIM_BALANCE;
    default:
      return risk.simInitialCapitalCrypto ?? DEFAULT_SIM_BALANCE;
  }
}

/** @deprecated Use per-algo functions (setCryptoSimInitialCapital etc.) instead. */
export function setSimInitialCapital(
  risk: RiskConfig,
  algoKind: SimAlgoKind,
  amount: number,
): void {
  switch (algoKind) {
    case 'weather':
      risk.simInitialCapitalWeather = amount;
      break;
    case 'copy':
      risk.simInitialCapitalCopy = amount;
      break;
    default:
      risk.simInitialCapitalCrypto = amount;
      break;
  }
}

// ─── Per-algo async update functions (preferred API) ─────────────────

export async function setCryptoSimInitialCapital(ds: DataSource, amount: number): Promise<void> {
  const service = new CryptoConfigService(ds);
  await service.updateConfig({ simInitialCapitalCrypto: amount });
}

export async function setWeatherSimInitialCapital(ds: DataSource, amount: number): Promise<void> {
  const service = new WeatherConfigService(ds);
  await service.updateConfig({ simInitialCapitalWeather: amount });
}

export async function setCopySimInitialCapital(ds: DataSource, amount: number): Promise<void> {
  const service = new CopyConfigService(ds);
  await service.updateConfig({ simInitialCapitalCopy: amount });
}
