import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postBackendJson } from './backend-client.js';

// Mock config
vi.mock('./config.js', () => ({
  config: {
    backendUrl: 'http://localhost:3000',
    serviceToken: 'test-token',
  },
}));

describe('postBackendJson', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with AbortError when fetch hangs beyond timeout', async () => {
    // Mock fetch to reject when the signal is aborted
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url: string | URL | Request, options?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          const signal = options?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }
          // Never resolve — hang until abort
        });
      },
    );

    // The default timeout is 5s, so this should reject within ~5s
    await expect(postBackendJson('/api/test', { key: 'value' })).rejects.toThrow(
      'Backend HTTP timeout',
    );
  }, 10000);

  it('resolves when fetch completes before timeout', async () => {
    const mockResponse = { ok: true, status: 200 } as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const result = await postBackendJson('/api/test', { key: 'value' });

    expect(result).toBe(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Service-Token': 'test-token',
        }),
      }),
    );
  });

  it('aborts when external signal is aborted', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url: string | URL | Request, options?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          const signal = options?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }
        });
      },
    );

    const promise = postBackendJson('/api/test', { key: 'value' }, controller.signal);

    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(promise).rejects.toThrow('Cancelled');
  });
});
