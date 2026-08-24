import type { UpDownPricePoint } from './market-chart';
import type { ExitAttemptEvent } from './exit-attempts';
import { normalizeMarkBid } from './exit-attempts';
import type { Execution } from './execution';

export const SIGNAL_MARKER_MAX_AGE_MS = 5000;
export const PRICE_GAP_MARKER_THRESHOLD = 0.03;

/**
 * Tolerance window for matching a chart signal (tick with `signalAgeMs`) to an
 * `ALGO_OPEN` execution by timestamp. Set to the full signal display window so
 * any execution within the visible signal lifetime is matched, avoiding
 * transient false "not executed" states while the pipeline is in flight.
 */
export const SIGNAL_MATCH_TOLERANCE_MS = 5000;

/**
 * Grace period during which a signal without any matching execution is
 * considered "pending" (pipeline in flight) rather than "not executed".
 * Prevents red flashes during the normal entry pipeline latency.
 */
export const EXECUTION_GRACE_MS = 1500;

export type SignalExecutionStatus =
  | { kind: 'executed'; fillPrice: number; slippagePercent: number | null }
  | {
      kind: 'failed';
      error: string | null;
      /** Slippage percent captured at guard time (from backend column), if any. */
      slippagePercent: number | null;
    }
  | { kind: 'pending' }
  | { kind: 'not_executed' };

/**
 * Resolve the execution status of a chart signal marker by matching the
 * signal emission instant (`point.t - signalAgeMs`) to an `ALGO_OPEN`
 * execution on the same conditionId within `SIGNAL_MATCH_TOLERANCE_MS`.
 *
 * Non-ambiguity relies on the crypto-algo re-entry throttle
 * (`cryptoAlgoMaxEntriesPerWindow` default 1 in production): at most one signal is active
 * per conditionId at any time, so the first timestamp match is authoritative.
 */
export function resolveSignalExecutionStatus(
  point: UpDownPricePoint,
  conditionId: string,
  executions: Execution[],
  _nowMs: number,
): SignalExecutionStatus {
  const m = point.metrics;
  const age = m?.signalAgeMs;
  if (age == null || age < 0) return { kind: 'not_executed' };

  const signalAtMs = point.t - age;

  const candidate = executions.find((ex) => {
    if (ex.conditionId !== conditionId) return false;
    if (ex.reason !== 'ALGO_OPEN') return false;
    if (ex.executedAt == null) return false;
    const execMs = Date.parse(ex.executedAt);
    if (!Number.isFinite(execMs)) return false;
    return Math.abs(execMs - signalAtMs) <= SIGNAL_MATCH_TOLERANCE_MS;
  });

  if (!candidate) {
    return age < EXECUTION_GRACE_MS ? { kind: 'pending' } : { kind: 'not_executed' };
  }

  if (candidate.status === 'filled') {
    return {
      kind: 'executed',
      fillPrice: candidate.fillPrice ?? 0,
      slippagePercent: candidate.slippagePercent ?? null,
    };
  }
  if (candidate.status === 'failed') {
    return {
      kind: 'failed',
      error: candidate.error ?? null,
      slippagePercent: candidate.slippagePercent ?? null,
    };
  }
  // placed / live_on_clob / partial / no_payout — still in flight or partial.
  return { kind: 'pending' };
}

export interface ChartOverlayToggles {
  showBidAskBands: boolean;
  showSignals: boolean;
  showPriceGap: boolean;
  showIlliquid: boolean;
  showPositionLevels: boolean;
  showPositionExecutionPrice: boolean;
  showPositionExitPrice: boolean;
  showSlExitAttempts: boolean;
}

export const DEFAULT_OVERLAY_TOGGLES: ChartOverlayToggles = {
  showBidAskBands: false,
  showSignals: false,
  showPriceGap: false,
  showIlliquid: false,
  showPositionLevels: true,
  showPositionExecutionPrice: true,
  showPositionExitPrice: true,
  showSlExitAttempts: true,
};

export interface SlExitAttemptMarker {
  t: number;
  kind: ExitAttemptEvent['kind'];
  blockReason: string | null;
  error: string | null;
  /** Decision bid mark (0–1); null → chart uses fixed top Y. */
  markBid: number | null;
  createdAt: string;
}

/**
 * SL non-executed attempt markers inside the chart time window.
 * Events outside [minT, maxT] are dropped (no edge clamping).
 */
export function buildSlExitAttemptMarkers(
  events: ExitAttemptEvent[],
  minT: number,
  maxT: number,
): SlExitAttemptMarker[] {
  if (!Number.isFinite(minT) || !Number.isFinite(maxT) || maxT < minT) {
    return [];
  }
  const markers: SlExitAttemptMarker[] = [];
  for (const event of events) {
    if (event.closeReason !== 'SL') continue;
    const t = Date.parse(event.createdAt);
    if (!Number.isFinite(t) || t < minT || t > maxT) continue;
    const markBid = normalizeMarkBid(event.markBid);
    markers.push({
      t,
      kind: event.kind,
      blockReason: event.blockReason,
      error: event.error,
      markBid,
      createdAt: event.createdAt,
    });
  }
  return markers;
}

interface BandSegment {
  t: number;
  bid: number;
  ask: number;
}

/** Resolve bid/ask for a side; fall back to mid + spreadPct when book legs are missing. */
export function resolveBandBidAsk(
  point: UpDownPricePoint,
  side: 'up' | 'down',
): { bid: number; ask: number } | null {
  const m = point.metrics;
  if (!m) return null;

  const bid = side === 'up' ? m.upBid : m.downBid;
  const ask = side === 'up' ? m.upAsk : m.downAsk;
  if (
    bid != null &&
    ask != null &&
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    ask >= bid
  ) {
    return { bid, ask };
  }

  const mid = side === 'up' ? point.up : point.down;
  const spreadPct = side === 'up' ? m.upSpreadPct : m.downSpreadPct;
  if (mid == null || spreadPct == null || !Number.isFinite(mid) || !Number.isFinite(spreadPct)) {
    return null;
  }
  // spreadPct = (ask - bid) / ask * 100  (same as computeSpreadPercent)
  const s = spreadPct / 100;
  if (s < 0 || s >= 1) return null;
  const askRe = (2 * mid) / (2 - s);
  const bidRe = askRe * (1 - s);
  if (!Number.isFinite(bidRe) || !Number.isFinite(askRe) || askRe < bidRe) return null;
  return { bid: bidRe, ask: askRe };
}

/** Contiguous runs of valid bid/ask samples (gaps break the polygon). */
function collectBandRuns(
  points: UpDownPricePoint[],
  side: 'up' | 'down',
): BandSegment[][] {
  const runs: BandSegment[][] = [];
  let current: BandSegment[] = [];

  for (const p of points) {
    const pair = resolveBandBidAsk(p, side);
    if (!pair) {
      if (current.length >= 2) runs.push(current);
      current = [];
      continue;
    }
    current.push({ t: p.t, bid: pair.bid, ask: pair.ask });
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

function bandCoordFns(
  minT: number,
  maxT: number,
  plotW: number,
  plotH: number,
  marginTop: number,
  marginLeft: number,
) {
  const rangeT = maxT - minT || 1;
  return {
    xPos: (t: number) => marginLeft + ((t - minT) / rangeT) * plotW,
    yPos: (price: number) => marginTop + (1 - price) * plotH,
  };
}

function polygonPathForRun(
  segments: BandSegment[],
  xPos: (t: number) => number,
  yPos: (price: number) => number,
): string {
  const forward = segments
    .map((s, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      return `${cmd}${xPos(s.t).toFixed(1)},${yPos(s.ask).toFixed(1)}`;
    })
    .join(' ');

  const backward = [...segments]
    .reverse()
    .map((s) => `L${xPos(s.t).toFixed(1)},${yPos(s.bid).toFixed(1)}`)
    .join(' ');

  return `${forward} ${backward} Z`;
}

function edgePathForRun(
  segments: BandSegment[],
  edge: 'bid' | 'ask',
  xPos: (t: number) => number,
  yPos: (price: number) => number,
): string {
  return segments
    .map((s, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      const price = edge === 'ask' ? s.ask : s.bid;
      return `${cmd}${xPos(s.t).toFixed(1)},${yPos(price).toFixed(1)}`;
    })
    .join(' ');
}

export interface BidAskBandGeometry {
  fills: string[];
  bidEdges: string[];
  askEdges: string[];
}

export function buildBidAskBandGeometry(
  points: UpDownPricePoint[],
  side: 'up' | 'down',
  minT: number,
  maxT: number,
  plotW: number,
  plotH: number,
  marginTop: number,
  marginLeft: number,
): BidAskBandGeometry {
  const runs = collectBandRuns(points, side);
  const { xPos, yPos } = bandCoordFns(
    minT,
    maxT,
    plotW,
    plotH,
    marginTop,
    marginLeft,
  );

  const fills: string[] = [];
  const bidEdges: string[] = [];
  const askEdges: string[] = [];
  for (const run of runs) {
    fills.push(polygonPathForRun(run, xPos, yPos));
    bidEdges.push(edgePathForRun(run, 'bid', xPos, yPos));
    askEdges.push(edgePathForRun(run, 'ask', xPos, yPos));
  }
  return { fills, bidEdges, askEdges };
}

/** @deprecated Prefer {@link buildBidAskBandGeometry}; kept for callers/tests. */
export function buildBidAskBandPath(
  points: UpDownPricePoint[],
  side: 'up' | 'down',
  minT: number,
  maxT: number,
  plotW: number,
  plotH: number,
  marginTop: number,
  marginLeft: number,
): string {
  return buildBidAskBandGeometry(
    points,
    side,
    minT,
    maxT,
    plotW,
    plotH,
    marginTop,
    marginLeft,
  ).fills.join(' ');
}

export function hasBidAskBandData(points: UpDownPricePoint[]): boolean {
  let count = 0;
  for (const p of points) {
    if (resolveBandBidAsk(p, 'up') || resolveBandBidAsk(p, 'down')) {
      count += 1;
      if (count >= 2) return true;
    }
  }
  return false;
}

export function findSignalMarkerIndices(points: UpDownPricePoint[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const age = points[i]?.metrics?.signalAgeMs;
    if (age != null && age >= 0 && age < SIGNAL_MARKER_MAX_AGE_MS) {
      indices.push(i);
    }
  }
  return indices;
}

export function findPositionOpenIndices(points: UpDownPricePoint[]): number[] {
  const indices: number[] = [];
  let prevCount = 0;
  for (let i = 0; i < points.length; i++) {
    const count = points[i]?.metrics?.openPositionsCount ?? 0;
    if (prevCount === 0 && count > 0) indices.push(i);
    prevCount = count;
  }
  return indices;
}

export function findPriceGapIndices(points: UpDownPricePoint[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const gap = points[i]?.metrics?.priceGap;
    if (gap != null && gap > PRICE_GAP_MARKER_THRESHOLD) indices.push(i);
  }
  return indices;
}

export function findIlliquidIndices(points: UpDownPricePoint[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const m = points[i]?.metrics;
    if (!m) continue;
    if (
      m.upLiquidityStatus === 'illiquid' ||
      m.downLiquidityStatus === 'illiquid'
    ) {
      indices.push(i);
    }
  }
  return indices;
}

export function findPartialLiquidityIndices(
  points: UpDownPricePoint[],
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const m = points[i]?.metrics;
    if (!m) continue;
    const up = m.upLiquidityStatus;
    const down = m.downLiquidityStatus;
    const illiquid =
      up === 'illiquid' || down === 'illiquid';
    if (illiquid) continue;
    if (up === 'partial' || down === 'partial') indices.push(i);
  }
  return indices;
}

export function hasChartMetrics(points: UpDownPricePoint[]): boolean {
  return points.some((p) => p.metrics != null);
}
