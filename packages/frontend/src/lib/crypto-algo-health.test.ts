import { describe, expect, it } from 'vitest';
import {
  deriveCryptoAlgoHealthAlerts,
  formatCountdown,
} from './crypto-algo-health';

describe('formatCountdown', () => {
  it('formats minutes and seconds', () => {
    expect(formatCountdown(125_000)).toBe('2 min 05 s');
  });

  it('formats sub-minute', () => {
    expect(formatCountdown(8_000)).toBe('8 s');
  });
});

describe('deriveCryptoAlgoHealthAlerts', () => {
  it('warns when process is stopped', () => {
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: false,
      cryptoAlgoEnabled: true,
      realTradingEnabled: false,
      enabledLiveMarketCount: 0,
      enabledSelectionCount: 0,
      selectionsWithMarket: 0,
      evaluableSelections: 0,
      autoTrackEnabledRuleCount: 1,
      nearestFutureStartMs: null,
      nearestFutureLabel: null,
      lastSkipReason: null,
    });
    expect(alerts.some((a) => a.title === 'Processus arrêté')).toBe(true);
  });

  it('shows countdown when auto-track has no live market', () => {
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: true,
      cryptoAlgoEnabled: true,
      realTradingEnabled: false,
      enabledLiveMarketCount: 0,
      enabledSelectionCount: 2,
      selectionsWithMarket: 2,
      evaluableSelections: 0,
      autoTrackEnabledRuleCount: 2,
      nearestFutureStartMs: 60_000,
      nearestFutureLabel: 'BTC 5m',
      lastSkipReason: null,
    });
    expect(alerts.some((a) => a.title === 'Hors fenêtre de trading')).toBe(true);
  });

  it('shows sim-only info when real trading disabled and algo enabled', () => {
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: true,
      cryptoAlgoEnabled: true,
      realTradingEnabled: false,
      enabledLiveMarketCount: 1,
      enabledSelectionCount: 1,
      selectionsWithMarket: 1,
      evaluableSelections: 1,
      autoTrackEnabledRuleCount: 1,
      nearestFutureStartMs: null,
      nearestFutureLabel: null,
      lastSkipReason: null,
    });
    expect(alerts.some((a) => a.title === 'Simulation uniquement')).toBe(true);
  });

  it('hides sim-only info when algo is disabled', () => {
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: true,
      cryptoAlgoEnabled: false,
      realTradingEnabled: false,
      enabledLiveMarketCount: 0,
      enabledSelectionCount: 0,
      selectionsWithMarket: 0,
      evaluableSelections: 0,
      autoTrackEnabledRuleCount: 0,
      nearestFutureStartMs: null,
      nearestFutureLabel: null,
      lastSkipReason: null,
    });
    expect(alerts.some((a) => a.title === 'Simulation uniquement')).toBe(false);
  });

  it('warns when selections lack market rows', () => {
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: true,
      cryptoAlgoEnabled: true,
      realTradingEnabled: false,
      enabledLiveMarketCount: 0,
      enabledSelectionCount: 2,
      selectionsWithMarket: 1,
      evaluableSelections: 1,
      autoTrackEnabledRuleCount: 0,
      nearestFutureStartMs: null,
      nearestFutureLabel: null,
      lastSkipReason: null,
    });
    expect(alerts.some((a) => a.title === 'Marchés non synchronisés')).toBe(true);
  });

  it('alerts on critical exit-emit blocks older than 30s', () => {
    const nowMs = Date.now();
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: true,
      cryptoAlgoEnabled: true,
      realTradingEnabled: false,
      enabledLiveMarketCount: 1,
      enabledSelectionCount: 1,
      selectionsWithMarket: 1,
      evaluableSelections: 1,
      autoTrackEnabledRuleCount: 1,
      nearestFutureStartMs: null,
      nearestFutureLabel: null,
      lastSkipReason: null,
      nowMs,
      exitEmitBlockedPositions: [
        {
          id: 18121,
          status: 'open',
          lastExitBlockReason: 'no_close_bid',
          lastExitBlockCloseReason: 'SL',
          firstExitBlockAt: new Date(nowMs - 45_000).toISOString(),
          exitEmitBlockedCount: 3,
        },
      ],
    });
    expect(alerts.some((a) => a.title === 'Sortie forcée bloquée')).toBe(true);
  });

  it('ignores cooldown and fresh SL confirmation blocks', () => {
    const nowMs = Date.now();
    const alerts = deriveCryptoAlgoHealthAlerts({
      processAlive: true,
      cryptoAlgoEnabled: true,
      realTradingEnabled: false,
      enabledLiveMarketCount: 1,
      enabledSelectionCount: 1,
      selectionsWithMarket: 1,
      evaluableSelections: 1,
      autoTrackEnabledRuleCount: 1,
      nearestFutureStartMs: null,
      nearestFutureLabel: null,
      lastSkipReason: null,
      nowMs,
      exitEmitBlockedPositions: [
        {
          id: 1,
          status: 'open',
          lastExitBlockReason: 'forced_exit_cooldown',
          lastExitBlockCloseReason: 'SL',
          firstExitBlockAt: new Date(nowMs - 120_000).toISOString(),
          exitEmitBlockedCount: 5,
        },
        {
          id: 2,
          status: 'open',
          lastExitBlockReason: 'no_close_bid',
          lastExitBlockCloseReason: 'SL',
          firstExitBlockAt: new Date(nowMs - 5_000).toISOString(),
          exitEmitBlockedCount: 1,
        },
      ],
    });
    expect(alerts.some((a) => a.title === 'Sortie forcée bloquée')).toBe(false);
  });
});
