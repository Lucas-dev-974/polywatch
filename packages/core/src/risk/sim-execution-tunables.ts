import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { RiskConfig } from '../entities/RiskConfig.js';

export type SimExecLatencyMode = 'fixed' | 'calibrated';

export const DEFAULT_SIM_EXEC_LATENCY_MS = 150;
export const DEFAULT_SIM_SELF_IMPACT_TTL_SECONDS = 8;
export const DEFAULT_SHADOW_SAMPLE_RETENTION_DAYS = 14;
export const MIN_LATENCY_SAMPLES_FOR_CALIBRATION = 10;
export const MAX_LATENCY_SAMPLES_LOAD = 200;

/** Resolved from env at module load (worker) or overridden in tests. */
export function resolveEnvSimExecutionLatencyMs(): number {
  const raw = process.env.SIM_EXECUTION_LATENCY_MS;
  if (raw === undefined || raw === '') return DEFAULT_SIM_EXEC_LATENCY_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SIM_EXEC_LATENCY_MS;
}

export interface SimExecutionTunables {
  latencyMode: SimExecLatencyMode;
  fixedLatencyMs: number;
  selfImpactEnabled: boolean;
  selfImpactTtlSeconds: number;
  walletPreflightEnabled: boolean;
  shadowLoggingEnabled: boolean;
  shadowSampleRetentionDays: number;
  recordLatencySamples: boolean;
}

export function resolveSimExecutionTunables(
  cfg: RiskConfig | GlobalConfig,
): SimExecutionTunables {
  const latencyMode: SimExecLatencyMode =
    cfg.simExecLatencyMode === 'calibrated' ? 'calibrated' : 'fixed';
  const fixedLatencyMs =
    cfg.simExecLatencyMs != null && cfg.simExecLatencyMs >= 0
      ? cfg.simExecLatencyMs
      : resolveEnvSimExecutionLatencyMs();

  const shadowLoggingEnabled = cfg.simShadowLoggingEnabled === true;
  const recordLatencySamples =
    latencyMode === 'calibrated' || shadowLoggingEnabled;

  return {
    latencyMode,
    fixedLatencyMs,
    selfImpactEnabled: cfg.simSelfImpactEnabled === true,
    selfImpactTtlSeconds:
      cfg.simSelfImpactTtlSeconds != null && cfg.simSelfImpactTtlSeconds >= 1
        ? cfg.simSelfImpactTtlSeconds
        : DEFAULT_SIM_SELF_IMPACT_TTL_SECONDS,
    walletPreflightEnabled: cfg.simWalletPreflightEnabled === true,
    shadowLoggingEnabled,
    shadowSampleRetentionDays:
      cfg.shadowSampleRetentionDays != null && cfg.shadowSampleRetentionDays >= 1
        ? cfg.shadowSampleRetentionDays
        : DEFAULT_SHADOW_SAMPLE_RETENTION_DAYS,
    recordLatencySamples,
  };
}
