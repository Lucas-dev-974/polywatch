import { describe, expect, it } from 'vitest';
import { riskConfigUpdateSchema } from './config.js';

describe('riskConfigUpdateSchema sim execution fields', () => {
  it('accepts valid sim execution tunables', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      simExecLatencyMode: 'calibrated',
      simExecLatencyMs: 150,
      simSelfImpactEnabled: true,
      simSelfImpactTtlSeconds: 8,
      simWalletPreflightEnabled: false,
      simShadowLoggingEnabled: true,
      shadowSampleRetentionDays: 14,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts null values for nullable sim fields', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      simExecLatencyMode: null,
      simExecLatencyMs: null,
      simSelfImpactEnabled: null,
      simSelfImpactTtlSeconds: null,
      simWalletPreflightEnabled: null,
      simShadowLoggingEnabled: null,
      shadowSampleRetentionDays: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid latency mode', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      simExecLatencyMode: 'random',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects negative latency ms', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      simExecLatencyMs: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      simExecLatencyMs: 100,
      unknownField: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts typical crypto algo report apply patch fields', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      cryptoAlgoSlPercent: 32,
      cryptoAlgoTrailingEnabled: true,
      cryptoAlgoTrailingActivationPercent: 12,
      cryptoAlgoTrailingPercent: 10,
      cryptoAlgoPreCloseEnabled: true,
      cryptoAlgoPreCloseSeconds: 45,
      cryptoAlgoPreCloseKeepEnabled: true,
      cryptoAlgoBaseThreshold: 0.62,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects revisionSource in body (meta field stripped by route handler)', () => {
    const parsed = riskConfigUpdateSchema.safeParse({
      cryptoAlgoSlPercent: 32,
      revisionSource: 'report_apply',
    });
    expect(parsed.success).toBe(false);
  });
});
