import type { RiskConfig } from '../entities/RiskConfig.js';
import type { SimAlgoKind } from './algo-kind.js';
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
