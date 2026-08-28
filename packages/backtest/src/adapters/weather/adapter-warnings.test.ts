import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../../engine/virtual-clock.js';
import { Ledger } from '../../engine/ledger.js';
import type { RunContext } from '../../engine/runner.js';
import { AdapterWarnings } from './adapter-warnings.js';
import type { WeatherFidelityStats } from './data-loader.js';

function ctx(): RunContext {
  return {
    runId: 1,
    clock: new VirtualClock(),
    ledger: new Ledger(1000),
    configSnapshot: {} as never,
    fidelityWarnings: [],
    excludedTicks: [],
    params: {
      slippageBps: 0,
      maxConcurrentPositions: 10,
      entryUsdc: 10,
      capital: 1000,
      strategyEnv: 'sim',
    },
    cancelRequested: () => false,
  };
}

const emptyStats: WeatherFidelityStats = {
  inactiveBucketsExcluded: 0,
  yesPriceNulls: 0,
  noPriceNulls: 0,
  forecastRevisions: 0,
  forecastRevisionsPerDay: 0,
  snapshots: 0,
  snapshotsPerDay: 0,
  missingSnapshots: 0,
  incompleteCityDates: 0,
};

describe('AdapterWarnings.emitFidelityStats (§12.2)', () => {
  it('emits no quantitative warnings when stats are all zero', () => {
    const c = ctx();
    new AdapterWarnings().emitFidelityStats(c, emptyStats);
    expect(c.fidelityWarnings).toEqual([]);
  });

  it('emits inactiveBucketsExcluded and arbitrage_unreliable when buckets are excluded', () => {
    const c = ctx();
    new AdapterWarnings().emitFidelityStats(c, {
      ...emptyStats,
      inactiveBucketsExcluded: 5,
      incompleteCityDates: 2,
    });
    const codes = c.fidelityWarnings.map((w) => w.split(':')[0]);
    expect(codes).toContain('inactiveBucketsExcluded');
    expect(codes).toContain('arbitrage_unreliable');
  });

  it('emits yesPriceNulls and noPriceNulls', () => {
    const c = ctx();
    new AdapterWarnings().emitFidelityStats(c, {
      ...emptyStats,
      yesPriceNulls: 3,
      noPriceNulls: 4,
    });
    const codes = c.fidelityWarnings.map((w) => w.split(':')[0]);
    expect(codes).toContain('yesPriceNulls');
    expect(codes).toContain('noPriceNulls');
  });

  it('emits snapshotsPerDay, forecastRevisionsPerDay and missingSnapshots', () => {
    const c = ctx();
    new AdapterWarnings().emitFidelityStats(c, {
      ...emptyStats,
      snapshots: 48,
      snapshotsPerDay: 48,
      forecastRevisions: 12,
      forecastRevisionsPerDay: 12,
      missingSnapshots: 1,
    });
    const codes = c.fidelityWarnings.map((w) => w.split(':')[0]);
    expect(codes).toContain('snapshotsPerDay');
    expect(codes).toContain('forecastRevisionsPerDay');
    expect(codes).toContain('missingSnapshots');
  });

  it('emits each code only once (warnOnce)', () => {
    const c = ctx();
    const w = new AdapterWarnings();
    w.emitFidelityStats(c, { ...emptyStats, inactiveBucketsExcluded: 2, incompleteCityDates: 1 });
    w.emitFidelityStats(c, { ...emptyStats, inactiveBucketsExcluded: 9, incompleteCityDates: 3 });
    const codes = c.fidelityWarnings.map((x) => x.split(':')[0]);
    expect(codes.filter((x) => x === 'inactiveBucketsExcluded')).toHaveLength(1);
    expect(codes.filter((x) => x === 'arbitrage_unreliable')).toHaveLength(1);
  });
});
