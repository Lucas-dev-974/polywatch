import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_STRATEGY_PARAMS,
  serializeWeatherAlgoStrategyParams,
} from '@polywatch/core';
import {
  formatStrategyParamValue,
  resolveBacktestRunStrategy,
  toRunDto,
} from './backtest-dto.js';

function snapshotJson(params: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({
    weatherAlgoStrategyParams: serializeWeatherAlgoStrategyParams(params),
  });
}

describe('formatStrategyParamValue', () => {
  it('formats booleans, nulls and select options', () => {
    expect(formatStrategyParamValue({ key: 'x', label: 'X', kind: 'boolean', default: true }, true)).toBe(
      'Oui',
    );
    expect(formatStrategyParamValue({ key: 'x', label: 'X', kind: 'number', default: 0 }, null)).toBe(
      'Désactivé',
    );
    expect(
      formatStrategyParamValue(
        {
          key: 'mode',
          label: 'Mode',
          kind: 'select',
          default: 'fixed_usdc',
          options: [{ value: 'fixed_usdc', label: 'Fixed USDC' }],
        },
        'fixed_usdc',
      ),
    ).toBe('Fixed USDC');
  });

  it('converts millisecond durations to minutes', () => {
    expect(
      formatStrategyParamValue(
        { key: 'reentryThrottleMs', label: 'Ré-entrée (ms)', kind: 'number', default: 1_800_000 },
        1_800_000,
      ),
    ).toBe('30 min');
    expect(
      formatStrategyParamValue(
        { key: 'entryDepthRetryDelayMs', label: 'Délai retry profondeur (ms)', kind: 'number', default: 1000 },
        1000,
      ),
    ).toBe('0.017 min');
  });
});

describe('resolveBacktestRunStrategy', () => {
  it('returns the strategy label and bag params from the snapshot', () => {
    const dto = resolveBacktestRunStrategy(
      {
        configSnapshotJson: snapshotJson({
          'weather-highest-yes': { minYesPrice: 0.62, entryUsdc: 25 },
        }),
      },
      { strategyId: 'weather-highest-yes' },
    );
    expect(dto?.id).toBe('weather-highest-yes');
    expect(dto?.label).toContain('Highest YES');
    const minYes = dto?.params.find((p) => p.key === 'minYesPrice');
    expect(minYes?.display).toBe('0.62');
    const entry = dto?.params.find((p) => p.key === 'entryUsdc');
    expect(entry?.display).toBe('25');
  });

  it('overlays launch-form entryUsdc and maxConcurrentPositions', () => {
    const dto = resolveBacktestRunStrategy(
      {
        configSnapshotJson: snapshotJson({
          'weather-forecast': { entryUsdc: 10, maxOpenPositions: 10 },
        }),
      },
      { strategyId: 'weather-forecast', entryUsdc: 42, maxConcurrentPositions: 3 },
    );
    expect(dto?.params.find((p) => p.key === 'entryUsdc')?.display).toBe('42');
    expect(dto?.params.find((p) => p.key === 'maxOpenPositions')?.display).toBe('3');
  });

  it('falls back to catalogue defaults when the bag is empty', () => {
    const dto = resolveBacktestRunStrategy(
      { configSnapshotJson: snapshotJson({}) },
      { strategyId: 'weather-forecast' },
    );
    expect(dto?.params.find((p) => p.key === 'minEdge')?.display).toBe(
      String(DEFAULT_WEATHER_STRATEGY_PARAMS.minEdge),
    );
    const throttle = dto?.params.find((p) => p.key === 'reentryThrottleMs');
    expect(throttle?.display).toBe('30 min');
    expect(throttle?.label).toMatch(/\(min\)/);
  });
});

describe('toRunDto', () => {
  it('attaches strategy on the run DTO', () => {
    const dto = toRunDto({
      id: 7,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      startedAt: null,
      finishedAt: null,
      status: 'completed',
      progressPct: 100,
      domain: 'weather',
      mode: 'reevaluate',
      label: null,
      paramsJson: JSON.stringify({ strategyId: 'weather-forecast-aligned' }),
      configSnapshotJson: snapshotJson({}),
      dataRangeFrom: null,
      dataRangeTo: null,
      statsJson: null,
      fidelityWarningsJson: null,
      engineVersion: '1',
      error: null,
      userId: 1,
      configFingerprint: null,
    } as never);
    expect(dto.strategy?.id).toBe('weather-forecast-aligned');
    expect(dto.strategy?.label).toContain('aligned');
    expect(dto.strategy?.params.length).toBeGreaterThan(0);
  });
});
