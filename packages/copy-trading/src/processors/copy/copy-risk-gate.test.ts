import { describe, it, expect, vi } from 'vitest';
import { evaluateCopyMoveGate, resolveCopyModesWithReasons } from './copy-risk-gate.js';
import type { MoveEventDto, CopyConfig, GlobalConfig, WatchlistEntry } from '@polywatch/core';
import type { DataSource } from 'typeorm';

function makeEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    id: 1,
    traderAddress: '0xtrader',
    nickname: 'trader',
    active: true,
    simEnabled: true,
    realEnabled: true,
    ...overrides,
  } as WatchlistEntry;
}

function makeCopyConfig(overrides: Partial<CopyConfig> = {}): CopyConfig {
  return {
    simCopyTradingEnabled: true,
    realCopyTradingEnabled: true,
    simCopyIncreaseEnabled: true,
    simCopyDecreaseEnabled: true,
    simMaxDailyLossPusd: 100,
    simKillSwitchAction: 'block_entries',
    realMaxDailyLossPusd: 100,
    realKillSwitchAction: 'block_entries',
    ...overrides,
  } as CopyConfig;
}

function makeGlobalConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    realTradingEnabled: true,
    ...overrides,
  } as GlobalConfig;
}

function makeMove(type: MoveEventDto['type']): MoveEventDto {
  return {
    id: 'move-1',
    traderAddress: '0xtrader',
    conditionId: '0xcond',
    assetId: '0xasset',
    type,
    traderSize: 100,
    previousTraderSize: 0,
    detectedAt: new Date(),
  } as MoveEventDto;
}

/** Chainable TypeORM query-builder mock for checkCopyKillSwitch. */
function makeKillSwitchDs(dailyNet = 0): {
  ds: DataSource;
  lastAndWhere: Array<{ clause: string; params?: Record<string, unknown> }>;
} {
  const lastAndWhere: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const qb = {
    select: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockImplementation((clause: string, params?: Record<string, unknown>) => {
      lastAndWhere.push({ clause, params });
      return qb;
    }),
    getRawOne: vi.fn().mockResolvedValue({ total: dailyNet }),
  };
  const ds = {
    getRepository: vi.fn().mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    }),
  } as unknown as DataSource;
  return { ds, lastAndWhere };
}

describe('evaluateCopyMoveGate', () => {
  it('blocks sim OPENED when simCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('OPENED'),
      makeEntry(),
      'sim',
      makeCopyConfig({ simCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading sim désactivé (config)',
    });
  });

  it('blocks sim INCREASED when simCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('INCREASED'),
      makeEntry(),
      'sim',
      makeCopyConfig({ simCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading sim désactivé (config)',
    });
  });

  it('allows sim CLOSED when simCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('CLOSED'),
      makeEntry(),
      'sim',
      makeCopyConfig({ simCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('allows sim DECREASED when simCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('DECREASED'),
      makeEntry(),
      'sim',
      makeCopyConfig({ simCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('blocks real OPENED when realCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('OPENED'),
      makeEntry(),
      'real',
      makeCopyConfig({ realCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading réel désactivé (config)',
    });
  });

  it('blocks real INCREASED when realCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('INCREASED'),
      makeEntry(),
      'real',
      makeCopyConfig({ realCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading réel désactivé (config)',
    });
  });

  it('allows real CLOSED when realCopyTradingEnabled is false', async () => {
    const { ds } = makeKillSwitchDs();
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('CLOSED'),
      makeEntry(),
      'real',
      makeCopyConfig({ realCopyTradingEnabled: false }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('scopes kill-switch PnL query to copy opening reasons', async () => {
    const { ds, lastAndWhere } = makeKillSwitchDs(-500);
    await evaluateCopyMoveGate(
      ds,
      makeMove('OPENED'),
      makeEntry(),
      'sim',
      makeCopyConfig({ simMaxDailyLossPusd: 100, simKillSwitchAction: 'block_entries' }),
      makeGlobalConfig(),
    );
    const reasonsClause = lastAndWhere.find((c) => c.clause.includes('p.reason IN'));
    expect(reasonsClause?.params?.reasons).toEqual(['COPY_OPEN', 'COPY_INCREASE']);
  });

  it('blocks OPENED when copy kill switch force_close_all is triggered', async () => {
    const { ds } = makeKillSwitchDs(-500);
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('OPENED'),
      makeEntry(),
      'sim',
      makeCopyConfig({
        simMaxDailyLossPusd: 100,
        simKillSwitchAction: 'force_close_all',
      }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Kill-switch force la fermeture de toutes les positions',
    });
  });

  it('allows CLOSED when copy kill switch force_close_all is triggered', async () => {
    const { ds } = makeKillSwitchDs(-500);
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('CLOSED'),
      makeEntry(),
      'sim',
      makeCopyConfig({
        simMaxDailyLossPusd: 100,
        simKillSwitchAction: 'force_close_all',
      }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('allows DECREASED when copy kill switch force_close_all is triggered', async () => {
    const { ds } = makeKillSwitchDs(-500);
    const result = await evaluateCopyMoveGate(
      ds,
      makeMove('DECREASED'),
      makeEntry(),
      'sim',
      makeCopyConfig({
        simMaxDailyLossPusd: 100,
        simKillSwitchAction: 'force_close_all',
        simCopyDecreaseEnabled: true,
      }),
      makeGlobalConfig(),
    );
    expect(result).toEqual({ allowed: true });
  });
});

describe('resolveCopyModesWithReasons', () => {
  it('returns both modes when both are enabled', () => {
    const entry = makeEntry({ simEnabled: true, realEnabled: true });
    const copyConfig = makeCopyConfig();
    const globalConfig = makeGlobalConfig({ realTradingEnabled: true });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, copyConfig, globalConfig);
    expect(modes).toEqual(['sim', 'real']);
    expect(skippedRealReason).toBeUndefined();
  });

  it('returns sim only when real is disabled in entry', () => {
    const entry = makeEntry({ simEnabled: true, realEnabled: false });
    const copyConfig = makeCopyConfig();
    const globalConfig = makeGlobalConfig({ realTradingEnabled: true });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, copyConfig, globalConfig);
    expect(modes).toEqual(['sim']);
    expect(skippedRealReason).toBeUndefined();
  });

  it('returns sim only when real is disabled in config and provides skip reason', () => {
    const entry = makeEntry({ simEnabled: true, realEnabled: true });
    const copyConfig = makeCopyConfig();
    const globalConfig = makeGlobalConfig({ realTradingEnabled: false });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, copyConfig, globalConfig);
    expect(modes).toEqual(['sim']);
    expect(skippedRealReason).toBe('Trading réel désactivé (config)');
  });

  it('returns empty modes when nothing is enabled', () => {
    const entry = makeEntry({ simEnabled: false, realEnabled: false });
    const copyConfig = makeCopyConfig();
    const globalConfig = makeGlobalConfig({ realTradingEnabled: false });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, copyConfig, globalConfig);
    expect(modes).toEqual([]);
    expect(skippedRealReason).toBeUndefined();
  });
});
