export interface Position {
  id: number;
  conditionId: string;
  assetId: string;
  outcome: string;
  quantity: number;
  entryPrice: number;
  entryBidVwap?: number;
  status: string;
  mode: string;
  unrealizedPnl: number;
  realizedPnl: number;
  liquidityStatus: string;
  closedAt: string | null;
  closeReason: string | null;
  openedAt: string | null;
  traderName: string | null;
  traderAddress: string | null;
  marketQuestion: string | null;
  marketUrl: string | null;
  marketIcon: string | null;
  marketEndDate: string | null;
  marketTagSlugs: string[];
  marketCategory: string | null;
  /** Market is resolved (payout known). */
  marketResolved: boolean;
  /** Market is closed (no longer accepting new orders). */
  marketClosed: boolean;
  /** Whether the CLOB still accepts orders on this market. */
  marketAcceptingOrders: boolean | null;
  /** Winning outcome token when the market is resolved. */
  marketWinningTokenId: string | null;
  entryFees: number;
  entryFeesRemaining?: number;
  /** Filled BUY quantity (closed positions only — quantity is 0 after exit). */
  entryQuantityFilled?: number | null;
  /** Total entry cost from BUY fills (closed positions only). */
  entryInvestedAmount?: number | null;
  increaseCount?: number;
  /** Latest failed SELL attempt while the position is still open. */
  lastCloseError?: string | null;
  /** Peak closure PnL percent reached during the position lifetime. */
  peakClosurePnlPercent?: number | null;
  /** Stop-loss threshold in bid points (absolute) for binary markets. */
  slBidPoints?: number | null;
  /** Take-profit threshold in bid points (absolute) for binary markets. */
  tpBidPoints?: number | null;
  /** Fill price of the last successful SELL execution (exit price). */
  exitBidVwap?: number | null;
  /** Pre-emit block: why a decided exit was not enqueued. */
  lastExitBlockReason?: string | null;
  lastExitBlockCloseReason?: string | null;
  firstExitBlockAt?: string | null;
  lastExitBlockAt?: string | null;
  exitEmitBlockedCount?: number | null;
}

export interface PnlTick {
  copiedPositionId: number;
  displayPnlPercent?: number;
  triggerPnlPercent: number;
  closurePnlPercent?: number;
  unrealizedPnl: number;
  bookConnectionHealthy: boolean;
}

export interface PnlSummary {
  totalGains: number;
  totalLosses: number;
  net: number;
}

export function summarizePnl(values: number[]): PnlSummary {
  let totalGains = 0;
  let totalLosses = 0;
  for (const value of values) {
    if (value > 0) totalGains += value;
    else if (value < 0) totalLosses += Math.abs(value);
  }
  return { totalGains, totalLosses, net: totalGains - totalLosses };
}

function openPositionPnl(
  pos: Position,
  pnlMap: Record<number, PnlTick>,
): number {
  return pnlMap[pos.id]?.unrealizedPnl ?? pos.unrealizedPnl;
}

export function summarizePositionsPnl(
  positions: Position[],
  pnlMap: Record<number, PnlTick>,
  realized: boolean,
): PnlSummary {
  const values = realized
    ? positions.map((pos) => pos.realizedPnl)
    : positions.map((pos) => openPositionPnl(pos, pnlMap));
  return summarizePnl(values);
}

export function formatPnlAmount(value: number, signed = false): string {
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${formatPusdAmount(value)}`;
}

/** Collateral token label (Polymarket deposit wallet + sim ledger). */
export const COLLATERAL_TOKEN = 'pUSD';

/** Adaptive decimals so sub-cent fills are not shown as 0.00. */
export function formatAdaptiveAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0.00';
  const abs = Math.abs(value);
  if (abs >= 0.01) return value.toFixed(2);
  if (abs >= 0.0001) return value.toFixed(4);
  return value.toFixed(6);
}

/**
 * Format a pUSD-denominated value, always keeping pUSD as the unit.
 * pUSD is the internal Polymarket collateral unit (6 decimals, 1:1 with USDC).
 * Examples: 0.00000123 -> "0.00000123 pUSD", 1234 -> "1234.00 pUSD".
 */
export function formatPusdAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0.00 pUSD';
  return `${value < 0 ? '-' : ''}${formatAdaptiveAmount(Math.abs(value))} pUSD`;
}

/**
 * Generic USD formatter. Kept for API compatibility, but prefer
 * `formatPusdAmount` for Polymarket pPnL because the internal collateral
 * unit is pUSD, not USD.
 */
export function formatUsdAmount(value: number): string {
  return formatPusdAmount(value);
}

export const formatCurrencyAmount = formatAdaptiveAmount;
export const formatShareQuantity = formatAdaptiveAmount;

const CLOSE_REASON_LABELS: Record<string, string> = {
  COPY_CLOSE: 'Copy',
  COPY_DECREASE: 'Copy',
  SL: 'Stop Loss',
  TP: 'Take Profit',
  TRAILING: 'Trailing',
  PRE_CLOSE_LOSS: 'Pré-clôture (perte)',
  PRE_CLOSE_WIN: 'Pré-clôture (gain)',
  WEATHER_FORECAST_CHANGE: 'Changement forecast',
  WEATHER_BUCKET_EXIT: 'Sortie palier',
  MANUAL: 'Manuel',
  REDEMPTION: 'Rédemption',
};

export function closeReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return CLOSE_REASON_LABELS[reason] ?? reason;
}

export function closeReasonBadgeClass(
  reason: string | null | undefined,
): string {
  if (!reason) return 'neutral';
  if (reason === 'COPY_CLOSE' || reason === 'COPY_DECREASE') return 'accent';
  if (reason === 'SL' || reason === 'PRE_CLOSE_LOSS')
    return 'danger';
  if (reason === 'TP' || reason === 'PRE_CLOSE_WIN') return 'success';
  if (reason === 'TRAILING' || reason === 'WEATHER_FORECAST_CHANGE' || reason === 'WEATHER_BUCKET_EXIT')
    return 'warn';
  return 'neutral';
}

export function pnlClass(value: number | undefined): string {
  if (value == null) return '';
  if (value > 0) return 'pnl-positive';
  if (value < 0) return 'pnl-negative';
  return '';
}

export function marketLabel(
  pos: Pick<Position, 'marketQuestion' | 'conditionId'>,
): string {
  if (pos.marketQuestion) return pos.marketQuestion;
  return `${pos.conditionId.slice(0, 10)}…`;
}

export interface MarketGroup {
  conditionId: string;
  label: string;
  positions: Position[];
}

export function groupPositionsByMarket(positions: Position[]): MarketGroup[] {
  const map = new Map<string, Position[]>();
  for (const pos of positions) {
    const list = map.get(pos.conditionId);
    if (list) list.push(pos);
    else map.set(pos.conditionId, [pos]);
  }

  const groups: MarketGroup[] = [];
  for (const [conditionId, groupPositions] of map) {
    groups.push({
      conditionId,
      label: marketLabel(groupPositions[0]!),
      positions: groupPositions,
    });
  }

  groups.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return groups;
}

export function marketGroupPnl(
  positions: Position[],
  pnlMap: Record<number, PnlTick>,
  realized: boolean,
): number {
  return positions.reduce((sum, pos) => {
    if (realized) return sum + pos.realizedPnl;
    return sum + (pnlMap[pos.id]?.unrealizedPnl ?? pos.unrealizedPnl);
  }, 0);
}

const OPEN_LIKE_STATUSES = new Set([
  'open',
  'closing',
  'pending_resolution',
  'failed',
]);

/** Entry fees still allocated to the remaining quantity (open) or total paid (closed). */
export function entryFeesForPosition(
  pos: Pick<Position, 'entryFees' | 'entryFeesRemaining' | 'status'>,
): number {
  if (OPEN_LIKE_STATUSES.has(pos.status) && pos.entryFeesRemaining != null) {
    return pos.entryFeesRemaining;
  }
  return pos.entryFees ?? 0;
}

export function investedAmount(
  pos: Pick<
    Position,
    | 'quantity'
    | 'entryPrice'
    | 'entryFees'
    | 'entryFeesRemaining'
    | 'status'
    | 'entryInvestedAmount'
  >,
): number {
  if (
    pos.status === 'closed' &&
    pos.entryInvestedAmount != null &&
    pos.entryInvestedAmount > 0
  ) {
    return pos.entryInvestedAmount;
  }
  return pos.quantity * pos.entryPrice + entryFeesForPosition(pos);
}

/** Share quantity at entry — for closed positions quantity is zeroed on exit. */
export function entryQuantityForDisplay(
  pos: Pick<Position, 'quantity' | 'status' | 'entryQuantityFilled'>,
): number {
  if (
    pos.status === 'closed' &&
    pos.quantity <= 0 &&
    pos.entryQuantityFilled != null &&
    pos.entryQuantityFilled > 0
  ) {
    return pos.entryQuantityFilled;
  }
  return pos.quantity;
}

export function pnlPercent(
  pnl: number | undefined,
  invested: number,
): number | undefined {
  if (pnl == null || invested <= 0) return undefined;
  return (pnl / invested) * 100;
}

export function formatPnlPercent(value: number | undefined): string {
  return value != null ? `${value.toFixed(2)}%` : '—%';
}

export interface SlDistance {
  /** Distance in bid points from current bid to SL threshold. */
  bidPoints: number | undefined;
  /** Whether the SL is configured and computable. */
  active: boolean;
  /** Whether the SL has been breached (position should be closing). */
  breached: boolean;
}

/**
 * Compute the remaining distance before the stop-loss is triggered.
 *
 * Uses bid points mode (binary markets): SL fires when bid ≤ entryBidVwap - slBidPoints.
 * Distance = currentBid - (entryBidVwap - slBidPoints).
 *
 * Returns `{ active: false }` when SL is not configured or data is missing.
 */
export function computeSlDistance(input: {
  slBidPoints?: number | null;
  entryBidVwap?: number;
  currentBid?: number;
}): SlDistance {
  const { slBidPoints, entryBidVwap, currentBid } = input;

  if (slBidPoints != null && slBidPoints > 0 && entryBidVwap != null && entryBidVwap > 0 && currentBid != null && currentBid > 0) {
    const slThreshold = entryBidVwap - slBidPoints;
    const distance = currentBid - slThreshold;
    return {
      bidPoints: distance,
      active: true,
      breached: currentBid <= slThreshold,
    };
  }

  return { bidPoints: undefined, active: false, breached: false };
}

export interface OpenPnlMetrics {
  /** Mark-to-bid vs entry ask, fees included — economic PNL if sold now. */
  amount: number;
  /** Bid vs entry price, fees included — aligned with SL/TP closure basis. */
  closurePercent: number | undefined;
  /** Bid vs entry bid — SL/TP/trailing trigger basis. */
  triggerPercent: number | undefined;
  invested: number;
}

export function openPnlMetrics(
  pos: Position,
  tick?: PnlTick,
): OpenPnlMetrics {
  const invested = investedAmount(pos);
  const amount = tick?.unrealizedPnl ?? pos.unrealizedPnl;
  const closurePercent =
    tick?.closurePnlPercent ??
    tick?.displayPnlPercent ??
    pnlPercent(amount, invested);
  const triggerPercent = tick?.triggerPnlPercent;
  return { amount, closurePercent, triggerPercent, invested };
}

const POSITION_STATUS_LABELS: Record<string, string> = {
  closing: 'Clôture…',
  failed: 'Échec',
  pending: 'En attente',
};

export function positionStatusLabel(status: string): string | null {
  return POSITION_STATUS_LABELS[status] ?? null;
}

export function positionStatusBadgeClass(status: string): string {
  if (status === 'closing') return 'accent';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warn';
  return 'neutral';
}

const LIQUIDITY_STATUS_LABELS: Record<string, string> = {
  partial: 'Liq. partielle',
  illiquid: 'Illiquide',
};

export function liquidityStatusLabel(status: string): string | null {
  if (status === 'ok') return null;
  return LIQUIDITY_STATUS_LABELS[status] ?? status;
}

export function modeLabel(mode: string): string {
  return mode === 'real' ? 'Réel' : 'Sim';
}

const MARKET_LIFECYCLE_LABELS: Record<string, string> = {
  resolved: 'Résolu',
  closed: 'Fermé',
};

export function marketLifecycleLabel(
  pos: Pick<Position, 'marketResolved' | 'marketClosed'>,
): string | null {
  if (pos.marketResolved) return MARKET_LIFECYCLE_LABELS.resolved;
  if (pos.marketClosed) return MARKET_LIFECYCLE_LABELS.closed;
  return null;
}

export function marketLifecycleBadgeClass(
  pos: Pick<Position, 'marketResolved' | 'marketClosed'>,
): string {
  if (pos.marketResolved) return 'success';
  if (pos.marketClosed) return 'warn';
  return 'neutral';
}

/** Countdown to endDate is only meaningful while the market is still live. */
export function shouldShowMarketEndCountdown(
  pos: Pick<Position, 'marketEndDate' | 'marketClosed' | 'marketResolved'>,
): boolean {
  if (!pos.marketEndDate) return false;
  return !pos.marketClosed && !pos.marketResolved;
}

export {
  canManualClosePosition,
  getRedemptionWaitPhase,
  isActionableFailure,
  isAwaitingRedemption,
  partitionActivePositions,
  redemptionProgressBadge,
  redemptionWaitHint,
  subMarketOutcomeKnownBadge,
} from './redemption-wait.js';
export type { PositionOutcomeBadge, RedemptionWaitPhase } from './redemption-wait.js';
