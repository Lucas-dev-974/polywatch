import { describe, expect, it, beforeEach } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  DEFAULT_SIM_EXEC_LATENCY_MS,
  resolveSimExecutionTunables,
} from '@polywatch/core';
import type { RiskConfig } from '@polywatch/core';
import {
  invalidateLatencySampleCache,
  sampleLatencyMs,
} from './latency-calibrator.js';

function risk(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return { id: 1, ...overrides } as RiskConfig;
}

function emptyDs(): DataSource {
  return {
    getRepository: () => ({
      find: async () => [],
    }),
  } as unknown as DataSource;
}

describe('sampleLatencyMs', () => {
  beforeEach(() => {
    invalidateLatencySampleCache();
  });

  it('returns fixed latency when mode is fixed', async () => {
    const ms = await sampleLatencyMs(
      emptyDs(),
      resolveSimExecutionTunables(
        risk({ simExecLatencyMs: 42, simExecLatencyMode: 'fixed' }),
      ),
    );
    expect(ms).toBe(42);
  });

  it('falls back to fixed when calibrated but no samples', async () => {
    const tunables = resolveSimExecutionTunables(
      risk({
        simExecLatencyMode: 'calibrated',
        simExecLatencyMs: null,
      }),
    );
    const ms = await sampleLatencyMs(emptyDs(), tunables);
    expect(ms).toBe(tunables.fixedLatencyMs);
    expect(tunables.fixedLatencyMs).toBe(DEFAULT_SIM_EXEC_LATENCY_MS);
  });
});
