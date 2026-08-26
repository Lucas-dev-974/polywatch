import { describe, expect, it } from 'vitest';
import type { CopyConfig } from '../entities/CopyConfig.js';
import {
  getCopyAllowedMarketTags,
  getCopyMinBidToAskRatio,
  getCopyMomentumFilterEnabled,
  isEntryBidAskRatioAcceptable,
  evaluateMomentumEntry,
  evaluateSlTpTrailing,
  isExitLegEnabled,
  resolveCopyEntryExitParams,
} from './policy.js';
import { isMarketTagAllowed } from '../market/tags.js';

function copyConfig(overrides: Partial<CopyConfig> = {}): CopyConfig {
  return {
    simAllowedMarketTags: '["sports"]',
    realAllowedMarketTags: '["crypto"]',
    simMinBidToAskRatio: 0.9,
    realMinBidToAskRatio: 0.9,
    simMomentumFilterEnabled: false,
    realMomentumFilterEnabled: false,
    ...overrides,
  } as CopyConfig;
}

describe('market tag policy', () => {
  it('parses per-mode allowed tag whitelists', () => {
    expect(getCopyAllowedMarketTags(copyConfig(), 'sim')).toEqual(['sports']);
    expect(getCopyAllowedMarketTags(copyConfig(), 'real')).toEqual(['crypto']);
  });

  it('allows all markets when whitelist is empty', () => {
    const cfg = copyConfig({ simAllowedMarketTags: '[]' });
    expect(isMarketTagAllowed(['politics'], getCopyAllowedMarketTags(cfg, 'sim'))).toBe(true);
  });

  it('blocks entries when no tag matches the whitelist', () => {
    const cfg = copyConfig();
    expect(isMarketTagAllowed(['politics'], getCopyAllowedMarketTags(cfg, 'sim'))).toBe(false);
    expect(isMarketTagAllowed(['nba', 'sports'], getCopyAllowedMarketTags(cfg, 'sim'))).toBe(true);
  });

  it('applies sim and real whitelists independently', () => {
    const cfg = copyConfig();
    expect(isMarketTagAllowed(['crypto'], getCopyAllowedMarketTags(cfg, 'sim'))).toBe(false);
    expect(isMarketTagAllowed(['crypto'], getCopyAllowedMarketTags(cfg, 'real'))).toBe(true);
  });
});

describe('entry bid/ask ratio gate', () => {
  it('accepts when ratio meets the configured minimum', () => {
    expect(isEntryBidAskRatioAcceptable(0.9, 1, 0.9)).toBe(true);
    expect(isEntryBidAskRatioAcceptable(0.89, 1, 0.9)).toBe(false);
  });

  it('rejects missing bid or ask liquidity when the gate is active', () => {
    expect(isEntryBidAskRatioAcceptable(0, 0.99, 0.9)).toBe(false);
    expect(isEntryBidAskRatioAcceptable(0.01, 0, 0.9)).toBe(false);
  });

  it('is disabled when min ratio is zero', () => {
    expect(isEntryBidAskRatioAcceptable(0.01, 0.99, 0)).toBe(true);
  });

  it('reads per-mode minimum ratio from copy config', () => {
    const cfg = copyConfig({
      simMinBidToAskRatio: 0.85,
      realMinBidToAskRatio: 0.75,
    });
    expect(getCopyMinBidToAskRatio(cfg, 'sim')).toBe(0.85);
    expect(getCopyMinBidToAskRatio(cfg, 'real')).toBe(0.75);
  });
});

describe('evaluateMomentumEntry', () => {
  it('passes when the filter is disabled, regardless of prices', () => {
    expect(evaluateMomentumEntry(0.3, 0.5, false)).toBe('pass');
  });

  it('passes when the entry ask is at or above the trader average', () => {
    expect(evaluateMomentumEntry(0.55, 0.5, true)).toBe('pass');
    expect(evaluateMomentumEntry(0.5, 0.5, true)).toBe('pass');
  });

  it('blocks when the entry ask is strictly below the trader average', () => {
    expect(evaluateMomentumEntry(0.45, 0.5, true)).toBe('block');
  });

  it('fails open when the trader average price is unavailable', () => {
    expect(evaluateMomentumEntry(0.45, 0, true)).toBe('skip_no_avg');
    expect(evaluateMomentumEntry(0.45, null, true)).toBe('skip_no_avg');
    expect(evaluateMomentumEntry(0.45, undefined, true)).toBe('skip_no_avg');
  });

  it('fails open when the entry ask VWAP is unavailable', () => {
    expect(evaluateMomentumEntry(0, 0.5, true)).toBe('skip_no_avg');
  });

  it('reads per-mode enablement from copy config', () => {
    const cfg = copyConfig({
      simMomentumFilterEnabled: true,
      realMomentumFilterEnabled: false,
    });
    expect(getCopyMomentumFilterEnabled(cfg, 'sim')).toBe(true);
    expect(getCopyMomentumFilterEnabled(cfg, 'real')).toBe(false);
  });
});

describe('evaluateSlTpTrailing - hybrid exit logic', () => {
  // Legacy position #3444: entry ask 0.99, bid 0.01, current bid 0.01
  // - trigger (market): 0% (bid vs entry bid)
  // - closure (economic): ~-99% (bid vs entry price)
  it('SL fires on closure breach even when market is flat (incident #3444)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: 40,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -85, // market crashed below SL threshold
      effectiveClosure: -99, // massive loss due to spread
      peakClosurePnlPercent: -5,
    });
    expect(result).toBe('SL');
  });

  it('SL fires on closure breach even when market shows gain (#3403)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: 40,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -85,
      effectiveClosure: -82,
      peakClosurePnlPercent: -5,
    });
    expect(result).toBe('SL');
  });

  it('SL does not fire when neither market nor closure breaches threshold', () => {
    const result = evaluateSlTpTrailing({
      slPercent: 40,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -10,
      effectiveClosure: -10,
      peakClosurePnlPercent: -5,
    });
    expect(result).toBeNull();
  });

  it('SL fires when market breaches threshold (classic drop)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: 40,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -85,
      effectiveClosure: -85,
      peakClosurePnlPercent: -5,
    });
    expect(result).toBe('SL');
  });

  // TP with AND logic
  it('TP does not fire when only market confirms (spread entry)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: 10,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: 25,
      effectiveClosure: -5,
      peakClosurePnlPercent: 5,
    });
    expect(result).toBeNull();
  });

  it('TP fires only when both market AND closure confirm gain (AND logic)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: 10,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: 25,
      effectiveClosure: 22,
      peakClosurePnlPercent: 22,
    });
    expect(result).toBe('TP');
  });

  it('TP does not fire when only closure confirms (market flat)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: 10,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -5,
      effectiveClosure: 25,
      peakClosurePnlPercent: 25,
    });
    expect(result).toBeNull();
  });
});

describe('evaluateSlTpTrailing - percentage mode (weather-algo)', () => {
  it('SL fires when closure PnL drops below -slPercent of invested amount', () => {
    const result = evaluateSlTpTrailing({
      slPercent: 20,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -25,
      effectiveClosure: -22,
      peakClosurePnlPercent: -5,
    });
    expect(result).toBe('SL');
  });

  it('SL does not fire when closure PnL is above -slPercent', () => {
    const result = evaluateSlTpTrailing({
      slPercent: 20,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -15,
      effectiveClosure: -15,
      peakClosurePnlPercent: -5,
    });
    expect(result).toBeNull();
  });

  it('TP fires when closure PnL reaches tpPercent and trigger is positive', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: 25,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: 30,
      effectiveClosure: 28,
      peakClosurePnlPercent: 28,
    });
    expect(result).toBe('TP');
  });

  it('TP does not fire when closure PnL is below tpPercent', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: 25,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: 20,
      effectiveClosure: 18,
      peakClosurePnlPercent: 18,
    });
    expect(result).toBeNull();
  });

  it('trailing fires on percentage drawdown from peak closure when armed', () => {
    // peak closure 40%, current closure 30% => drawdown 10% >= trailingPercent 10
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: null,
      trailingPercent: 10,
      trailingActivationPercent: 12,
      effectiveTrigger: 30,
      effectiveClosure: 30,
      peakClosurePnlPercent: 40,
    });
    expect(result).toBe('TRAILING');
  });

  it('trailing does not fire when not armed (closure below activation)', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: null,
      trailingPercent: 10,
      trailingActivationPercent: 12,
      effectiveTrigger: 8,
      effectiveClosure: 8,
      peakClosurePnlPercent: 40,
    });
    expect(result).toBeNull();
  });

  it('SL does not fire when no threshold is configured', () => {
    const result = evaluateSlTpTrailing({
      slPercent: null,
      tpPercent: null,
      trailingPercent: null,
      trailingActivationPercent: null,
      effectiveTrigger: -15,
      effectiveClosure: -15,
      peakClosurePnlPercent: -15,
    });
    expect(result).toBeNull();
  });
});

describe('isExitLegEnabled', () => {
  it('is fail-closed: only explicit true enables', () => {
    expect(isExitLegEnabled(true)).toBe(true);
    expect(isExitLegEnabled(false)).toBe(false);
    expect(isExitLegEnabled(null)).toBe(false);
    expect(isExitLegEnabled(undefined)).toBe(false);
  });
});

describe('resolveCopyEntryExitParams', () => {
  function exitCopy(overrides: Partial<CopyConfig> = {}): CopyConfig {
    return copyConfig({
      simSlEnabled: true,
      simTpEnabled: true,
      simSlPercent: 20,
      simTpPercent: 25,
      simTrailingEnabled: true,
      simTrailingPercent: 10,
      simTrailingActivationPercent: 12,
      realSlEnabled: true,
      realTpEnabled: true,
      realSlPercent: 20,
      realTpPercent: 25,
      realTrailingEnabled: false,
      realTrailingPercent: 10,
      realTrailingActivationPercent: 12,
      ...overrides,
    });
  }

  it('enables SL and TP independently', () => {
    expect(
      resolveCopyEntryExitParams(
        exitCopy({ simSlEnabled: false, simTpEnabled: true }),
        'sim',
      ),
    ).toMatchObject({ slPercent: null, tpPercent: 25 });
    expect(
      resolveCopyEntryExitParams(
        exitCopy({ simSlEnabled: true, simTpEnabled: false }),
        'sim',
      ),
    ).toMatchObject({ slPercent: 20, tpPercent: null });
  });

  it('keeps trailing independent from SL/TP toggles', () => {
    expect(
      resolveCopyEntryExitParams(
        exitCopy({
          simSlEnabled: false,
          simTpEnabled: false,
          simTrailingEnabled: true,
        }),
        'sim',
      ),
    ).toMatchObject({
      slPercent: null,
      tpPercent: null,
      trailingPercent: 10,
      trailingActivationPercent: 12,
    });
  });
});
