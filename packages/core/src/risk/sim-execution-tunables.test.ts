import { describe, expect, it } from 'vitest';
import type { RiskConfig } from '../entities/RiskConfig.js';
import {
  DEFAULT_SIM_EXEC_LATENCY_MS,
  DEFAULT_SIM_SELF_IMPACT_TTL_SECONDS,
  DEFAULT_SHADOW_SAMPLE_RETENTION_DAYS,
  resolveSimExecutionTunables,
} from './sim-execution-tunables.js';

function baseRisk(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return { id: 1, ...overrides } as RiskConfig;
}

describe('resolveSimExecutionTunables', () => {
  it('uses code defaults when fields are null', () => {
    const t = resolveSimExecutionTunables(baseRisk());
    expect(t.latencyMode).toBe('fixed');
    expect(t.fixedLatencyMs).toBe(DEFAULT_SIM_EXEC_LATENCY_MS);
    expect(t.selfImpactEnabled).toBe(false);
    expect(t.selfImpactTtlSeconds).toBe(DEFAULT_SIM_SELF_IMPACT_TTL_SECONDS);
    expect(t.walletPreflightEnabled).toBe(false);
    expect(t.shadowLoggingEnabled).toBe(false);
    expect(t.shadowSampleRetentionDays).toBe(DEFAULT_SHADOW_SAMPLE_RETENTION_DAYS);
    expect(t.recordLatencySamples).toBe(false);
  });

  it('enables recordLatencySamples for calibrated mode', () => {
    const t = resolveSimExecutionTunables(
      baseRisk({ simExecLatencyMode: 'calibrated' }),
    );
    expect(t.latencyMode).toBe('calibrated');
    expect(t.recordLatencySamples).toBe(true);
  });

  it('enables recordLatencySamples when shadow logging is on', () => {
    const t = resolveSimExecutionTunables(
      baseRisk({ simShadowLoggingEnabled: true }),
    );
    expect(t.recordLatencySamples).toBe(true);
  });

  it('respects explicit overrides', () => {
    const t = resolveSimExecutionTunables(
      baseRisk({
        simExecLatencyMs: 80,
        simSelfImpactEnabled: true,
        simSelfImpactTtlSeconds: 12,
        simWalletPreflightEnabled: true,
        simShadowLoggingEnabled: true,
        shadowSampleRetentionDays: 7,
      }),
    );
    expect(t.fixedLatencyMs).toBe(80);
    expect(t.selfImpactEnabled).toBe(true);
    expect(t.selfImpactTtlSeconds).toBe(12);
    expect(t.walletPreflightEnabled).toBe(true);
    expect(t.shadowLoggingEnabled).toBe(true);
    expect(t.shadowSampleRetentionDays).toBe(7);
  });
});
