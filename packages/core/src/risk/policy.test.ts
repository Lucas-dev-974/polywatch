import { describe, expect, it } from 'vitest';
import type { CopyConfig } from '../entities/CopyConfig.js';
import {
  getCopyAllowedMarketTags,
  getCopyMinBidToAskRatio,
  getCopyMomentumFilterEnabled,
  isEntryBidAskRatioAcceptable,
  evaluateMomentumEntry,
  evaluateSlTpTrailing,
  isTrailingArmed,
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
      slBidPoints: 0.40,
      tpBidPoints: null,
      trailingBidPoints: null,
      effectiveTrigger: -85, // market crashed below SL threshold
      effectiveClosure: -99, // massive loss due to spread
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBe('SL');
  });

  // Legacy position #3403: entry ask 0.99, bid 0.16, current bid 0.16
  // - trigger: +12% (bid vs entry bid)
  // - closure: -82% (bid vs entry price)
  it('SL fires on closure breach even when market shows gain (#3403)', () => {
    const result = evaluateSlTpTrailing({
      slBidPoints: 0.40,
      tpBidPoints: null,
      trailingBidPoints: null,
      effectiveTrigger: -85, // market crashed below SL threshold
      effectiveClosure: -82, // closure down
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBe('SL');
  });

  it('SL does not fire when neither market nor closure breaches threshold', () => {
    const result = evaluateSlTpTrailing({
      slBidPoints: 0.40,
      tpBidPoints: null,
      trailingBidPoints: null,
      effectiveTrigger: -50,
      effectiveClosure: -50,
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBeNull();
  });

  it('SL fires when market breaches threshold (classic drop)', () => {
    const result = evaluateSlTpTrailing({
      slBidPoints: 0.40,
      tpBidPoints: null,
      trailingBidPoints: null,
      effectiveTrigger: -85,
      effectiveClosure: -85,
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBe('SL');
  });

  // TP with AND logic
  it('TP does not fire when only market confirms (spread entry)', () => {
    const result = evaluateSlTpTrailing({
      slBidPoints: null,
      tpBidPoints: 0.10,
      trailingBidPoints: null,
      effectiveTrigger: 25, // market up
      effectiveClosure: -5, // closure still negative due to spread
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBeNull();
  });

  it('TP fires only when both market AND closure confirm gain (AND logic)', () => {
    const result = evaluateSlTpTrailing({
      slBidPoints: null,
      tpBidPoints: 0.10,
      trailingBidPoints: null,
      effectiveTrigger: 25,
      effectiveClosure: 22,
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBe('TP');
  });

  it('TP does not fire when only closure confirms (market flat)', () => {
    const result = evaluateSlTpTrailing({
      slBidPoints: null,
      tpBidPoints: 0.10,
      trailingBidPoints: null,
      effectiveTrigger: 5, // market not at TP yet
      effectiveClosure: 25, // closure at TP
      peakBidVwap: 0.50,
      entryBidVwap: 0.50,
    });
    expect(result).toBeNull();
  });
});

describe('evaluateSlTpTrailing - bid points thresholds (binary markets)', () => {
  // Bid points mode: slBidPoints/tpBidPoints are offsets from entryBidVwap.
  // When slBidPoints/tpBidPoints are null, behavior must fall back to percent mode.

  it('SL fires in bid points mode when bid drops by slBidPoints from entry', () => {
    // entryBidVwap 0.55, slBidPoints 0.10 → SL at bid <= 0.45
    // (0.45 - 0.55) / 0.55 ≈ -18.18%, so trigger <= -19 crosses the threshold
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: -19,
      effectiveClosure: -19,
      peakBidVwap: 0.50,
      slBidPoints: 0.10,
      tpBidPoints: null,
      entryBidVwap: 0.55,
    });
    expect(result).toBe('SL');
  });

  it('SL bid points is uniform across entry prices (same 0.10 points delta)', () => {
    // entry 0.40 with 0.10 points → SL at 0.30
    // entry 0.85 with 0.10 points → SL at 0.75
    // At bid 0.29: both fire (0.29 < 0.30 and 0.29 < 0.75)
    const low = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: -27, effectiveClosure: -27, peakBidVwap: 0.50,
      slBidPoints: 0.10, tpBidPoints: null, entryBidVwap: 0.40,
    });
    const high = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: -65, effectiveClosure: -65, peakBidVwap: 0.50,
      slBidPoints: 0.10, tpBidPoints: null, entryBidVwap: 0.85,
    });
    expect(low).toBe('SL');
    expect(high).toBe('SL');
    
    // At bid 0.72: entry 0.85 fires (0.72 < 0.75), entry 0.40 does not (0.72 > 0.30)
    const highAt72 = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: -15, effectiveClosure: -15, peakBidVwap: 0.50,
      slBidPoints: 0.10, tpBidPoints: null, entryBidVwap: 0.85,
    });
    const lowAt72 = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: 80, effectiveClosure: 80, peakBidVwap: 0.50,
      slBidPoints: 0.10, tpBidPoints: null, entryBidVwap: 0.40,
    });
    expect(highAt72).toBe('SL');
    expect(lowAt72).toBeNull();
  });

  it('TP bid points fires when bid >= entryBidVwap + tpBidPoints AND closure >= 0', () => {
    // entryBidVwap 0.55, tpBidPoints 0.12 → TP at bid >= 0.67
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: 22, // (0.67 - 0.55) / 0.55 ≈ 22%
      effectiveClosure: 5, // non-negative → fee guard passes
      peakBidVwap: 0.50,
      slBidPoints: null,
      tpBidPoints: 0.12,
      entryBidVwap: 0.55,
    });
    expect(result).toBe('TP');
  });

  it('TP bid points does NOT fire when closure < 0 (fee guard fails)', () => {
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: 22,
      effectiveClosure: -1, // fees eat the gain → fee guard blocks TP
      peakBidVwap: 0.50,
      slBidPoints: null,
      tpBidPoints: 0.12,
      entryBidVwap: 0.55,
    });
    expect(result).toBeNull();
  });

  it('TP bid points is capped at 0.99', () => {
    // entryBidVwap 0.95 + 0.10 points → 1.05, capped at 0.99
    // (0.99 - 0.95) / 0.95 ≈ 4.21%, so trigger >= 5 crosses the cap
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: 5,
      effectiveClosure: 5,
      peakBidVwap: 0.50,
      slBidPoints: null,
      tpBidPoints: 0.10,
      entryBidVwap: 0.95,
    });
    // At bid 0.99, TP should fire (capped threshold reached)
    expect(result).toBe('TP');
  });

  it('falls back to trailing-only when slBidPoints/tpBidPoints are null', () => {
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: -85,
      effectiveClosure: -85,
      peakBidVwap: 0.50,
      slBidPoints: null,
      tpBidPoints: null,
      entryBidVwap: 0.50,
    });
    // No bid points and no trailing → no SL/TP fires
    expect(result).toBeNull();
  });

  it('bid points SL fires when threshold is breached', () => {
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: -90,
      effectiveClosure: -90,
      peakBidVwap: 0.50,
      slBidPoints: 0.10,
      tpBidPoints: null,
      entryBidVwap: 0.50, // bid points SL fires at bid 0.40
    });
    expect(result).toBe('SL');
  });

  it('does not fire bid points SL when entryBidVwap is 0 (no fill yet)', () => {
    // entryBidVwap = 0 means position not filled yet — skip absolute mode
    const result = evaluateSlTpTrailing({
      trailingBidPoints: null,
      effectiveTrigger: 0,
      effectiveClosure: 0,
      peakBidVwap: 0.50,
      slBidPoints: 0.10,
      tpBidPoints: null,
      entryBidVwap: 0,
    });
    // entryBidVwap = 0 → bid points mode is skipped (no fill yet)
    // No trailing stop either → no exit
    expect(result).toBeNull();
  });
});

describe('isTrailingArmed', () => {
  it('arms immediately when no activation threshold (null or undefined)', () => {
    expect(isTrailingArmed(0.5, 0.5, null)).toBe(true);
    expect(isTrailingArmed(0.5, 0.5, undefined)).toBe(true);
  });

  it('does NOT arm immediately when threshold is 0 (arm at break-even)', () => {
    // 0 is a valid threshold: the trailing only arms when currentBid >= entryBidVwap + 0.
    // A position opened at 0.48 bid with entry 0.50 must NOT trigger immediately.
    expect(isTrailingArmed(0.48, 0.50, 0)).toBe(false);
    expect(isTrailingArmed(0.50, 0.50, 0)).toBe(true);   // exactly at break-even
    expect(isTrailingArmed(0.51, 0.50, 0)).toBe(true);   // above break-even
  });

  it('arms when current bid reaches activation threshold above entry', () => {
    // entryBidVwap = 0.50, activationBidPoints = 0.10 → arm at bid >= 0.60
    expect(isTrailingArmed(0.65, 0.50, 0.10)).toBe(true);
    expect(isTrailingArmed(0.60, 0.50, 0.10)).toBe(true);
    expect(isTrailingArmed(0.55, 0.50, 0.10)).toBe(false);
  });
});

describe('evaluateSlTpTrailing - trailing stop', () => {
  it('trailing fires when drawdown from peak bid exceeds threshold', () => {
    // entryBidVwap = 0.50, peakBidVwap = 0.70, currentBid = 0.65
    // effectiveTrigger = (0.65 - 0.50) / 0.50 * 100 = 30%
    // drawdown = 0.70 - 0.65 = 0.05, trailingBidPoints = 0.05 → fires
    const result = evaluateSlTpTrailing({
      trailingBidPoints: 0.05,
      trailingActivationBidPoints: 0.10,
      effectiveTrigger: 30,
      effectiveClosure: 28,
      peakBidVwap: 0.70,
      entryBidVwap: 0.50,
    });
    // peakBidVwap(0.70) - currentBid(0.65) = 0.05 >= trailingBidPoints(0.05)
    expect(result).toBe('TRAILING');
  });

  it('trailing does not fire when not armed', () => {
    // entryBidVwap = 0.50, activationBidPoints = 0.10 → arm at 0.60
    // currentBid = 0.55 (effectiveTrigger = 10%) → not armed
    const result = evaluateSlTpTrailing({
      trailingBidPoints: 0.05,
      trailingActivationBidPoints: 0.10,
      effectiveTrigger: 10,
      effectiveClosure: 8,
      peakBidVwap: 0.70,
      entryBidVwap: 0.50,
    });
    expect(result).toBeNull();
  });

  it('trailing does not fire when drawdown is below threshold', () => {
    // entryBidVwap = 0.50, peakBidVwap = 0.70, currentBid = 0.68
    // drawdown = 0.70 - 0.68 = 0.02, trailingBidPoints = 0.05 → no fire
    const result = evaluateSlTpTrailing({
      trailingBidPoints: 0.05,
      trailingActivationBidPoints: 0.10,
      effectiveTrigger: 36,
      effectiveClosure: 34,
      peakBidVwap: 0.70,
      entryBidVwap: 0.50,
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
      simSlBidPoints: 0.1,
      simTpBidPoints: 0.12,
      simTrailingEnabled: true,
      simTrailingBidPoints: 0.05,
      simTrailingActivationBidPoints: 0.06,
      realSlEnabled: true,
      realTpEnabled: true,
      realSlBidPoints: 0.08,
      realTpBidPoints: 0.15,
      realTrailingEnabled: false,
      realTrailingBidPoints: 0.05,
      realTrailingActivationBidPoints: 0.06,
      ...overrides,
    });
  }

  it('enables SL and TP independently', () => {
    expect(
      resolveCopyEntryExitParams(
        exitCopy({ simSlEnabled: false, simTpEnabled: true }),
        'sim',
      ),
    ).toMatchObject({ slBidPoints: null, tpBidPoints: 0.12 });
    expect(
      resolveCopyEntryExitParams(
        exitCopy({ simSlEnabled: true, simTpEnabled: false }),
        'sim',
      ),
    ).toMatchObject({ slBidPoints: 0.1, tpBidPoints: null });
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
      slBidPoints: null,
      tpBidPoints: null,
      trailingBidPoints: 0.05,
      trailingActivationBidPoints: 0.06,
    });
  });
});
