import { describe, it, expect, vi } from 'vitest';
import { evaluateCopyMoveGate, resolveCopyModesWithReasons } from './copy-risk-gate.js';
import type { MoveEventDto, RiskConfig, WatchlistEntry } from '@polywatch/core';
import { RiskService } from '@polywatch/core';
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

function makeRisk(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    simCopyTradingEnabled: true,
    realCopyTradingEnabled: true,
    simCopyIncreaseEnabled: true,
    simCopyDecreaseEnabled: true,
    realTradingEnabled: true,
    ...overrides,
  } as RiskConfig;
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

function makeRiskService(): RiskService {
  return {
    checkKillSwitch: vi.fn().mockResolvedValue({
      killSwitchTriggered: false,
      blockEntries: false,
      action: 'block_entries',
    }),
    shouldBlockEntry: () => false,
    shouldForceCloseAll: () => false,
    shouldBlockAndNotify: () => false,
  } as unknown as RiskService;
}

describe('evaluateCopyMoveGate', () => {
  it('blocks sim OPENED when simCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('OPENED'),
      makeEntry(),
      'sim',
      makeRisk({ simCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading sim désactivé (config)',
    });
  });

  it('blocks sim INCREASED when simCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('INCREASED'),
      makeEntry(),
      'sim',
      makeRisk({ simCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading sim désactivé (config)',
    });
  });

  it('allows sim CLOSED when simCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('CLOSED'),
      makeEntry(),
      'sim',
      makeRisk({ simCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('allows sim DECREASED when simCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('DECREASED'),
      makeEntry(),
      'sim',
      makeRisk({ simCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('blocks real OPENED when realCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('OPENED'),
      makeEntry(),
      'real',
      makeRisk({ realCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading réel désactivé (config)',
    });
  });

  it('blocks real INCREASED when realCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('INCREASED'),
      makeEntry(),
      'real',
      makeRisk({ realCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({
      allowed: false,
      reason: 'Copy trading réel désactivé (config)',
    });
  });

  it('allows real CLOSED when realCopyTradingEnabled is false', async () => {
    const result = await evaluateCopyMoveGate(
      {} as DataSource,
      makeMove('CLOSED'),
      makeEntry(),
      'real',
      makeRisk({ realCopyTradingEnabled: false }),
      makeRiskService(),
    );
    expect(result).toEqual({ allowed: true });
  });
});

describe('resolveCopyModesWithReasons', () => {
  it('returns both modes when both are enabled', () => {
    const entry = makeEntry({ simEnabled: true, realEnabled: true });
    const risk = makeRisk({ realTradingEnabled: true });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, risk);
    expect(modes).toEqual(['sim', 'real']);
    expect(skippedRealReason).toBeUndefined();
  });

  it('returns sim only when real is disabled in entry', () => {
    const entry = makeEntry({ simEnabled: true, realEnabled: false });
    const risk = makeRisk({ realTradingEnabled: true });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, risk);
    expect(modes).toEqual(['sim']);
    expect(skippedRealReason).toBeUndefined();
  });

  it('returns sim only when real is disabled in config and provides skip reason', () => {
    const entry = makeEntry({ simEnabled: true, realEnabled: true });
    const risk = makeRisk({ realTradingEnabled: false });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, risk);
    expect(modes).toEqual(['sim']);
    expect(skippedRealReason).toBe('Trading réel désactivé (config)');
  });

  it('returns empty modes when nothing is enabled', () => {
    const entry = makeEntry({ simEnabled: false, realEnabled: false });
    const risk = makeRisk({ realTradingEnabled: false });
    const { modes, skippedRealReason } = resolveCopyModesWithReasons(entry, risk);
    expect(modes).toEqual([]);
    expect(skippedRealReason).toBeUndefined();
  });
});
