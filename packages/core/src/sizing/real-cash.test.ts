import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';

const getBackendJson = vi.fn();

vi.mock('../worker-shared/backend-client.js', () => ({
  BACKEND_HTTP_TIMEOUT_MS: 5000,
  createBackendClient: () => ({ getBackendJson }),
}));

import { fetchAvailableRealCash } from './real-cash.js';

function mockDs(globalConfig: { realCashOverride: number | null } | null): DataSource {
  return {
    getRepository: () => ({
      findOne: async () => globalConfig,
    }),
  } as unknown as DataSource;
}

describe('fetchAvailableRealCash', () => {
  it('returns realCashOverride from GlobalConfig when set', async () => {
    const ds = mockDs({ realCashOverride: 5000 });
    const result = await fetchAvailableRealCash(ds, 'http://backend', 'token');
    expect(result).toBe(5000);
    expect(getBackendJson).not.toHaveBeenCalled();
  });

  it('falls back to backend when override is null and returns amount', async () => {
    const ds = mockDs({ realCashOverride: null });
    getBackendJson.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ amount: 1234.56 }),
    });
    const result = await fetchAvailableRealCash(ds, 'http://backend', 'token');
    expect(result).toBe(1234.56);
    expect(getBackendJson).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when backend responds non-OK', async () => {
    const ds = mockDs({ realCashOverride: null });
    getBackendJson.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await fetchAvailableRealCash(ds, 'http://backend', 'token');
    expect(result).toBeUndefined();
  });

  it('returns undefined when backend response shape is unexpected', async () => {
    const ds = mockDs({ realCashOverride: null });
    getBackendJson.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'nope' }),
    });
    const result = await fetchAvailableRealCash(ds, 'http://backend', 'token');
    expect(result).toBeUndefined();
  });

  it('returns undefined when GlobalConfig read throws and backend throws', async () => {
    const ds = {
      getRepository: () => ({
        findOne: async () => {
          throw new Error('db down');
        },
      }),
    } as unknown as DataSource;
    getBackendJson.mockRejectedValueOnce(new Error('network down'));
    const result = await fetchAvailableRealCash(ds, 'http://backend', 'token');
    expect(result).toBeUndefined();
  });

  it('accepts a custom logName without changing behavior', async () => {
    const ds = mockDs({ realCashOverride: 42 });
    const result = await fetchAvailableRealCash(ds, 'http://backend', 'token', 'custom-ns');
    expect(result).toBe(42);
  });
});