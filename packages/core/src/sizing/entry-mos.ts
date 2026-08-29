import { MIN_ORDER_SHARES } from './constants.js';

/** Conservative floor when per-market MOS metadata is unavailable at entry. */
export const CONSERVATIVE_ENTRY_MOS_FLOOR = 5;

export type MinOrderSharesSource = 'clob' | 'book' | 'fallback';

export interface MinOrderSharesDetailed {
  minShares: number;
  source: MinOrderSharesSource;
}

/** Entry MOS with conservative floor when lookup fell back to global minimum. */
export function effectiveEntryMos(detailed: MinOrderSharesDetailed): number {
  if (detailed.source === 'fallback') {
    return Math.max(MIN_ORDER_SHARES, CONSERVATIVE_ENTRY_MOS_FLOOR);
  }
  return detailed.minShares;
}

export type EnsureEntryQuantityMeetsMosResult =
  | { ok: true; quantity: number; bumped: boolean; effectiveMos: number }
  | { ok: false; reason: 'below_mos_cannot_bump' };

/**
 * Bump target quantity to market MOS when cash and position cap allow it.
 * Pure function — no I/O.
 */
export function ensureEntryQuantityMeetsMos(params: {
  targetQty: number;
  effectiveMos: number;
  askVwap: number;
  cash: number;
  maxPositionSizePusd: number;
}): EnsureEntryQuantityMeetsMosResult {
  const { targetQty, effectiveMos, askVwap, cash, maxPositionSizePusd } = params;

  if (targetQty >= effectiveMos) {
    return { ok: true, quantity: targetQty, bumped: false, effectiveMos };
  }

  const bumpedNotional = effectiveMos * askVwap;
  if (bumpedNotional > cash + 1e-9 || bumpedNotional > maxPositionSizePusd + 1e-9) {
    return { ok: false, reason: 'below_mos_cannot_bump' };
  }

  return { ok: true, quantity: effectiveMos, bumped: true, effectiveMos };
}

export const ENTRY_MOS_SKIP_CANNOT_BUMP =
  'Quantité sous le minimum marché (MOS), bump impossible';

export const ENTRY_MOS_SKIP_NO_LIQUIDITY_BUMP =
  'Pas de liquidité à la quantité MOS (bump)';
