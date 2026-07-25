import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyBackendExecution } from './notify-execution.js';
import { postBackendJson } from '../backend-client.js';

vi.mock('../backend-client.js', () => ({
  postBackendJson: vi.fn(),
}));

describe('notifyBackendExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls postBackendJson with the correct payload', async () => {
    const payload = {
      orderSignalId: 'sig-1',
      status: 'filled',
      fillPrice: 0.5,
      fillQuantity: 100,
      fees: 0.01,
    };

    vi.mocked(postBackendJson).mockResolvedValue({ ok: true } as any);

    await notifyBackendExecution(payload);

    expect(postBackendJson).toHaveBeenCalledWith('/api/executions', payload);
  });

  it('does not throw when postBackendJson fails', async () => {
    vi.mocked(postBackendJson).mockRejectedValue(new Error('Network error'));

    // Should not throw — the error is caught and logged
    await expect(
      notifyBackendExecution({
        orderSignalId: 'sig-1',
        status: 'filled',
        fillPrice: 0.5,
        fillQuantity: 100,
        fees: 0.01,
      }),
    ).resolves.toBeUndefined();
  });
});
