import { beforeEach, describe, expect, it, vi } from 'vitest';

const { finalize, loadOrphanPlacingSim, setAlgoEntryCooldown } = vi.hoisted(() => ({
  finalize: vi.fn().mockResolvedValue(null),
  loadOrphanPlacingSim: vi.fn(),
  setAlgoEntryCooldown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@polywatch/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@polywatch/core')>();
  return {
    ...actual,
    ExecutionService: vi.fn().mockImplementation(() => ({
      loadOrphanPlacingSim,
      finalize,
    })),
    setAlgoEntryCooldown,
  };
});

import { PlacingJanitor } from './placing-janitor.js';

describe('PlacingJanitor', () => {
  const redisCmd = { set: vi.fn().mockResolvedValue('OK') };
  let janitor: PlacingJanitor;
  let findOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    findOne = vi.fn().mockResolvedValue({
      conditionId: 'cond-algo',
    });
    const ds = {
      getRepository: vi.fn().mockReturnValue({ findOne }),
    };
    janitor = new PlacingJanitor(ds as never, redisCmd);
  });

  it('sets algo entry cooldown after ALGO_OPEN BUY orphan finalize', async () => {
    loadOrphanPlacingSim.mockResolvedValue([
      {
        orderSignalId: 'sig-1',
        copiedPositionId: 99,
        side: 'BUY',
        reason: 'ALGO_OPEN',
        mode: 'sim',
      },
    ]);

    await janitor.run();

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'placing_orphan' }),
    );
    expect(setAlgoEntryCooldown).toHaveBeenCalledWith(
      redisCmd,
      'cond-algo',
      'sim',
    );
  });

  it('does not set cooldown for non-ALGO orphan', async () => {
    loadOrphanPlacingSim.mockResolvedValue([
      {
        orderSignalId: 'sig-2',
        copiedPositionId: 100,
        side: 'SELL',
        reason: 'TRAILING',
        mode: 'sim',
      },
    ]);

    await janitor.run();

    expect(setAlgoEntryCooldown).not.toHaveBeenCalled();
  });
});
