import type { TraderInsightActivityInput } from './build-trader-insight.js';

export interface TraderCapitalSeriesPoint {
  /** ISO-8601 timestamp for the chart x-axis. */
  t: string;
  value: number;
  /** True when the point uses live portfolio value from Polymarket. */
  isLive?: boolean;
}

interface PositionLot {
  shares: number;
  lastPrice: number;
}

const MS_PER_WEEK = 7 * 86_400_000;

function weekStartKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function weekStartMs(key: string): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

function enumerateWeekKeys(firstMs: number, lastMs: number): string[] {
  const keys: string[] = [];
  let cursor = weekStartMs(weekStartKey(firstMs));
  const end = weekStartMs(weekStartKey(lastMs));
  while (cursor <= end) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += MS_PER_WEEK;
  }
  return keys.length > 0 ? keys : [weekStartKey(firstMs)];
}

function shareDelta(
  activity: TraderInsightActivityInput,
  price: number,
): number {
  if (Number.isFinite(activity.size) && Math.abs(activity.size!) > 0) {
    return Math.abs(activity.size!);
  }
  const usdc = Number.isFinite(activity.usdcSize) ? activity.usdcSize : 0;
  return price > 0 ? usdc / price : 0;
}

function computeEquity(
  cash: number,
  positions: Map<string, PositionLot>,
): number {
  let positionValue = 0;
  for (const pos of positions.values()) {
    if (pos.shares > 0 && pos.lastPrice > 0) {
      positionValue += pos.shares * pos.lastPrice;
    }
  }
  return cash + positionValue;
}

function applyCapitalEvent(
  activity: TraderInsightActivityInput,
  cash: number,
  positions: Map<string, PositionLot>,
): number {
  const key = activity.conditionId.toLowerCase();
  const type = activity.type.toUpperCase();
  const usdc = Number.isFinite(activity.usdcSize) ? activity.usdcSize : 0;
  const price =
    Number.isFinite(activity.price) && (activity.price ?? 0) > 0
      ? activity.price!
      : 0;

  if (type === 'TRADE') {
    if (activity.side === 'BUY') {
      cash -= usdc;
      const pos = positions.get(key) ?? { shares: 0, lastPrice: price };
      pos.shares += shareDelta(activity, price);
      if (price > 0) pos.lastPrice = price;
      positions.set(key, pos);
      return cash;
    }
    if (activity.side === 'SELL') {
      cash += usdc;
      const pos = positions.get(key);
      if (pos) {
        const sold = shareDelta(activity, price);
        pos.shares = Math.max(0, pos.shares - sold);
        if (price > 0) pos.lastPrice = price;
        if (pos.shares <= 0) positions.delete(key);
        else positions.set(key, pos);
      }
      return cash;
    }
    return cash;
  }

  if (type === 'REDEEM') {
    cash += usdc;
    positions.delete(key);
  }

  return cash;
}

function anchorCapitalSeries(
  points: TraderCapitalSeriesPoint[],
  livePortfolioValue?: number,
): TraderCapitalSeriesPoint[] {
  if (points.length === 0) {
    if (livePortfolioValue != null && Number.isFinite(livePortfolioValue)) {
      return [
        {
          t: new Date().toISOString(),
          value: livePortfolioValue,
          isLive: true,
        },
      ];
    }
    return [];
  }

  if (livePortfolioValue == null || !Number.isFinite(livePortfolioValue)) {
    return points;
  }

  const lastHistorical = points[points.length - 1]!;
  const offset = livePortfolioValue - lastHistorical.value;
  const anchored = points.map((point) => ({
    ...point,
    value: point.value + offset,
  }));

  const lastAnchored = anchored[anchored.length - 1]!;
  if (lastAnchored.isLive) {
    lastAnchored.value = livePortfolioValue;
    return anchored;
  }

  anchored.push({
    t: new Date().toISOString(),
    value: livePortfolioValue,
    isLive: true,
  });
  return anchored;
}

export function filterCapitalActivities(
  activities: TraderInsightActivityInput[],
): TraderInsightActivityInput[] {
  return activities.filter((activity) => {
    if (activity.timestamp <= 0) return false;
    const type = activity.type.toUpperCase();
    if (type === 'REDEEM') return true;
    if (type === 'TRADE') {
      return activity.side === 'BUY' || activity.side === 'SELL';
    }
    return false;
  });
}

/**
 * Rebuilds a weekly portfolio-value curve from trade/redeem activity.
 * When `livePortfolioValue` is provided, the series is shifted so the last
 * historical point matches the live Polymarket `/value` reading.
 */
export function buildTraderCapitalSeries(
  activities: TraderInsightActivityInput[],
  livePortfolioValue?: number,
): TraderCapitalSeriesPoint[] {
  const sorted = [...filterCapitalActivities(activities)].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  if (sorted.length === 0) {
    return anchorCapitalSeries([], livePortfolioValue);
  }

  let cash = 0;
  const positions = new Map<string, PositionLot>();
  let eventIdx = 0;

  const firstMs = sorted[0]!.timestamp * 1000;
  const lastMs = sorted[sorted.length - 1]!.timestamp * 1000;
  const weekKeys = enumerateWeekKeys(firstMs, lastMs);
  const points: TraderCapitalSeriesPoint[] = [];

  for (const weekKey of weekKeys) {
    const weekEndSec = Math.floor((weekStartMs(weekKey) + MS_PER_WEEK - 1) / 1000);
    while (
      eventIdx < sorted.length &&
      sorted[eventIdx]!.timestamp <= weekEndSec
    ) {
      cash = applyCapitalEvent(sorted[eventIdx]!, cash, positions);
      eventIdx++;
    }
    points.push({
      t: new Date(weekStartMs(weekKey) + MS_PER_WEEK - 1).toISOString(),
      value: computeEquity(cash, positions),
    });
  }

  while (eventIdx < sorted.length) {
    cash = applyCapitalEvent(sorted[eventIdx]!, cash, positions);
    eventIdx++;
  }

  if (points.length > 0) {
    points[points.length - 1]!.value = computeEquity(cash, positions);
  }

  return anchorCapitalSeries(points, livePortfolioValue);
}
