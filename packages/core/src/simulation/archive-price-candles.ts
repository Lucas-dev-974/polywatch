type CandleAccumulator = {
  source: 'algo' | 'market' | 'position';
  conditionId: string;
  assetId: string | null;
  bucketStart: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
};

function minuteBucket(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function bucketKey(
  source: string,
  conditionId: string,
  assetId: string | null,
  bucket: Date,
): string {
  return `${source}|${conditionId}|${assetId ?? ''}|${bucket.toISOString()}`;
}

function upsertCandle(
  map: Map<string, CandleAccumulator>,
  source: 'algo' | 'market' | 'position',
  conditionId: string,
  assetId: string | null,
  at: Date,
  price: number,
): void {
  if (!Number.isFinite(price)) return;
  const bucketStart = minuteBucket(at);
  const key = bucketKey(source, conditionId, assetId, bucketStart);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      source,
      conditionId,
      assetId,
      bucketStart,
      open: price,
      high: price,
      low: price,
      close: price,
      tickCount: 1,
    });
    return;
  }
  existing.high = Math.max(existing.high, price);
  existing.low = Math.min(existing.low, price);
  existing.close = price;
  existing.tickCount += 1;
}

export function aggregateAlgoTickPrice(
  upPrice: number | null,
  downPrice: number | null,
): number | null {
  if (upPrice != null && downPrice != null) return (upPrice + downPrice) / 2;
  return upPrice ?? downPrice ?? null;
}

export function aggregateMarketTickPrice(tick: {
  midPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
}): number | null {
  if (tick.midPrice != null) return tick.midPrice;
  if (tick.bestBid != null && tick.bestAsk != null) {
    return (tick.bestBid + tick.bestAsk) / 2;
  }
  return tick.bestBid ?? tick.bestAsk ?? tick.lastTradePrice ?? null;
}

export function buildCandlesFromTicks(
  ticks: Array<{
    source: 'algo' | 'market' | 'position';
    conditionId: string;
    assetId: string | null;
    at: Date;
    price: number | null;
  }>,
): CandleAccumulator[] {
  const map = new Map<string, CandleAccumulator>();
  const sorted = [...ticks].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const tick of sorted) {
    if (tick.price == null) continue;
    upsertCandle(
      map,
      tick.source,
      tick.conditionId,
      tick.assetId,
      tick.at,
      tick.price,
    );
  }
  return [...map.values()].sort(
    (a, b) => a.bucketStart.getTime() - b.bucketStart.getTime(),
  );
}

export type { CandleAccumulator };
