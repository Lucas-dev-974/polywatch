/** Mid price sample for curve descending gate. */
export interface MidHistorySample {
  t: number;
  mid: number;
}

/** Decimation interval when recording WS mids into the buffer. */
export const CURVE_SAMPLE_INTERVAL_MS = 500;

/** Maximum age of samples retained per asset. */
export const CURVE_BUFFER_MAX_MS = 60_000;

/**
 * Ring buffer of bilateral WS mids per CLOB asset id.
 * Used by the curve descending entry gate.
 */
export class MidHistoryBuffer {
  private readonly samples = new Map<string, MidHistorySample[]>();
  private readonly lastRecordedAt = new Map<string, number>();

  record(assetId: string, mid: number, nowMs: number): void {
    if (!Number.isFinite(mid) || mid <= 0) return;

    const lastAt = this.lastRecordedAt.get(assetId) ?? 0;
    if (nowMs - lastAt < CURVE_SAMPLE_INTERVAL_MS) return;

    let series = this.samples.get(assetId);
    if (!series) {
      series = [];
      this.samples.set(assetId, series);
    }

    series.push({ t: nowMs, mid });
    this.lastRecordedAt.set(assetId, nowMs);
    this.prune(assetId, nowMs);
  }

  getWindow(
    assetId: string,
    lookbackMs: number,
    nowMs: number,
  ): MidHistorySample[] {
    const series = this.samples.get(assetId);
    if (!series || series.length === 0) return [];

    const cutoff = nowMs - lookbackMs;
    return series.filter((s) => s.t >= cutoff);
  }

  clear(assetId: string): void {
    this.samples.delete(assetId);
    this.lastRecordedAt.delete(assetId);
  }

  clearCondition(tokenIdYes: string | null, tokenIdNo: string | null): void {
    if (tokenIdYes) this.clear(tokenIdYes);
    if (tokenIdNo) this.clear(tokenIdNo);
  }

  clearAll(): void {
    this.samples.clear();
    this.lastRecordedAt.clear();
  }

  private prune(assetId: string, nowMs: number): void {
    const series = this.samples.get(assetId);
    if (!series) return;

    const cutoff = nowMs - CURVE_BUFFER_MAX_MS;
    while (series.length > 0 && series[0]!.t < cutoff) {
      series.shift();
    }
    if (series.length === 0) {
      this.samples.delete(assetId);
      this.lastRecordedAt.delete(assetId);
    }
  }
}
