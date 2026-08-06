import type { DataSource } from 'typeorm';
import type { SimAlgoKind } from './algo-kind.js';
import { CryptoConfigService } from '../services/crypto-config.service.js';
import { WeatherConfigService } from '../services/weather-config.service.js';
import { CopyConfigService } from '../services/copy-config.service.js';
import { DEFAULT_SIM_BALANCE } from './constants.js';

export type SimInitialCapitalSource = {
  simInitialCapitalCrypto?: number;
  simInitialCapitalWeather?: number;
  simInitialCapitalCopy?: number;
};

export function getSimInitialCapital(
  risk: Partial<SimInitialCapitalSource> | null | undefined,
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
