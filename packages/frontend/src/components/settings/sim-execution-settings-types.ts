// Type local pour les champs d'exécution simulation (provenant de GlobalConfig via /api/config/global).
export interface RiskConfig {
  simExecLatencyMode: string | null;
  simExecLatencyMs: number | null;
  simSelfImpactEnabled: boolean | null;
  simSelfImpactTtlSeconds: number | null;
  simWalletPreflightEnabled: boolean | null;
  simShadowLoggingEnabled: boolean | null;
  shadowSampleRetentionDays: number | null;
}

import { api } from '../../api';

export type SimExecutionSettings = Pick<
  RiskConfig,
  | 'simExecLatencyMode'
  | 'simExecLatencyMs'
  | 'simSelfImpactEnabled'
  | 'simSelfImpactTtlSeconds'
  | 'simWalletPreflightEnabled'
  | 'simShadowLoggingEnabled'
  | 'shadowSampleRetentionDays'
>;

export type SimExecutionStats = {
  latencySampleCount: number;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  sufficientForCalibration: boolean;
  shadowFillCount: number;
  shadowAvgPriceDeltaPct: number | null;
  shadowAvgQtyDeltaPct: number | null;
};

export const SIM_EXECUTION_SETTINGS_KEYS: (keyof SimExecutionSettings)[] = [
  'simExecLatencyMode',
  'simExecLatencyMs',
  'simSelfImpactEnabled',
  'simSelfImpactTtlSeconds',
  'simWalletPreflightEnabled',
  'simShadowLoggingEnabled',
  'shadowSampleRetentionDays',
];

export function pickSimExecutionFields(
  config: RiskConfig,
): SimExecutionSettings {
  return {
    simExecLatencyMode: config.simExecLatencyMode,
    simExecLatencyMs: config.simExecLatencyMs,
    simSelfImpactEnabled: config.simSelfImpactEnabled,
    simSelfImpactTtlSeconds: config.simSelfImpactTtlSeconds,
    simWalletPreflightEnabled: config.simWalletPreflightEnabled,
    simShadowLoggingEnabled: config.simShadowLoggingEnabled,
    shadowSampleRetentionDays: config.shadowSampleRetentionDays,
  };
}

export async function fetchSimExecutionStats(): Promise<SimExecutionStats> {
  return api<SimExecutionStats>('/sim-execution-stats');
}
