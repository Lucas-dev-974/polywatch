export const OPEN_SNAPSHOT_DELAY_MS = 5_000;
export const CLOSE_SNAPSHOT_DELAY_MS = 2_000;

/** Max wait after marketEndAt before marking a snapshot unresolved (aligned with captureClose poll). */
export const SURVEILLANCE_CLOSE_TTL_MS = 5 * 60_000;

/** One outcome must be at payoff (1) and the other at 0 after resolution. */
export const REDEMPTION_WIN_THRESHOLD = 0.99;
export const REDEMPTION_LOSS_THRESHOLD = 0.01;

export interface OutcomePrices {
  upPrice: number | null;
  downPrice: number | null;
}

export function isRedemptionOutcomePrices(prices: OutcomePrices): boolean {
  const { upPrice: up, downPrice: down } = prices;
  if (up != null && up >= REDEMPTION_WIN_THRESHOLD) {
    return down == null || down <= REDEMPTION_LOSS_THRESHOLD;
  }
  if (down != null && down >= REDEMPTION_WIN_THRESHOLD) {
    return up == null || up <= REDEMPTION_LOSS_THRESHOLD;
  }
  return false;
}

/** Algo position linked to a surveillance market window (by conditionId). */
export interface AlgoSurveillancePositionSummary {
  id: number;
  outcome: string;
  mode: string;
  status: string;
  /** Remaining share quantity (0 after a full exit). */
  quantity: number;
  /** Filled BUY quantity for closed positions when {@link quantity} is 0. */
  entryQuantityFilled: number | null;
  /** Outcome token id (for MOS / order-size lookups). */
  assetId: string;
  entryPrice: number;
  /** Bid VWAP at entry — source for chart SL/TP overlays. */
  entryBidVwap: number;
  slBidPoints: number | null;
  tpBidPoints: number | null;
  /** Last successful SELL fill price; null when open or no SELL fill. */
  exitBidVwap: number | null;
  unrealizedPnl: number;
  realizedPnl: number;
  openedAt: string | null;
  closedAt: string | null;
  reason: string | null;
  /** Set when a pending entry is cancelled before fill (e.g. reservation TTL). */
  closeReason: string | null;
  /** First failed sim BUY execution error, if any. */
  executionErrorSim: string | null;
  /** First failed real BUY execution error, if any. */
  executionErrorReal: string | null;
  /**
   * Pre-execution skip while the position never filled (e.g. still in worker queue).
   * Machine code — map to French in the UI.
   */
  skipReason: string | null;
}

export {
  RESERVATION_CLOSE_REASON_EXPIRED,
  RESERVATION_CLOSE_REASON_RELEASED,
  SURVEILLANCE_SKIP_PENDING_EXECUTION,
} from '../positions/reservation-close-reasons.js';

export interface AlgoSurveillanceSnapshotDto {
  id: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  marketStartAt: string | null;
  marketEndAt: string | null;
  openUpPrice: number | null;
  openDownPrice: number | null;
  openCapturedAt: string | null;
  closeUpPrice: number | null;
  closeDownPrice: number | null;
  closeCapturedAt: string | null;
  winningOutcome: string | null;
  unresolvedAt: string | null;
  positions: AlgoSurveillancePositionSummary[];
  /** True when positions were frozen at market close (not a live DB join). */
  positionsFrozen?: boolean;
}

type SurveillancePhaseSnapshot = Pick<
  AlgoSurveillanceSnapshotDto,
  'openCapturedAt' | 'closeCapturedAt' | 'unresolvedAt' | 'marketEndAt'
>;

function isSurveillancePendingClose(snapshot: SurveillancePhaseSnapshot): boolean {
  return Boolean(
    snapshot.openCapturedAt && !snapshot.closeCapturedAt && !snapshot.unresolvedAt,
  );
}

/** Opening snapshot captured; market window still open (close not yet due). */
export function isSurveillanceLive(
  snapshot: SurveillancePhaseSnapshot,
  nowMs: number,
): boolean {
  if (!isSurveillancePendingClose(snapshot)) return false;
  if (!snapshot.marketEndAt) return false;
  const endMs = Date.parse(snapshot.marketEndAt);
  if (!Number.isFinite(endMs)) return false;
  return nowMs < endMs;
}

/** Market window ended; waiting for close snapshot or outcome (within TTL). */
export function isSurveillanceAwaitingClose(
  snapshot: SurveillancePhaseSnapshot,
  nowMs: number,
): boolean {
  if (!isSurveillancePendingClose(snapshot)) return false;
  if (!snapshot.marketEndAt) return true;
  const endMs = Date.parse(snapshot.marketEndAt);
  if (!Number.isFinite(endMs)) return true;
  return nowMs >= endMs && nowMs < endMs + SURVEILLANCE_CLOSE_TTL_MS;
}

export interface UpsertSurveillanceMetaInput {
  conditionId: string;
  question?: string | null;
  cryptoSymbol?: string | null;
  interval?: string | null;
  slug?: string | null;
  marketStartAt?: Date | string | null;
  marketEndAt?: Date | string | null;
}
