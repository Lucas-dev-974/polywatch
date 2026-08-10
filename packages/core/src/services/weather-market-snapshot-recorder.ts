import type { DataSource } from 'typeorm';
import { WeatherMarketSnapshot } from '../entities/WeatherMarketSnapshot.js';
import { WeatherBucketTick } from '../entities/WeatherBucketTick.js';

export interface BucketTickInput {
  conditionId: string;
  eventSlug: string | null;
  question: string | null;
  bucketComparison: string;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  volume: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  acceptingOrders: boolean | null;
  closed: boolean;
  endDate: Date | null;
}

export class WeatherMarketSnapshotRecorder {
  constructor(private readonly ds: DataSource) {}

  async recordSnapshot(input: {
    city: string;
    cityNormalized: string;
    targetDateIso: string;
    metric: string;
    forecastMean: number | null;
    forecastStdDev: number | null;
    buckets: BucketTickInput[];
    totalBucketCount: number;
    ruleId: number | null;
    fidelityMinutes: number | null;
  }): Promise<{ snapshotId: number }> {
    const recordedAt = new Date();
    return await this.ds.transaction(async (em) => {
      const snapshot = await em.getRepository(WeatherMarketSnapshot).save({
        city: input.city,
        cityNormalized: input.cityNormalized,
        targetDateIso: input.targetDateIso,
        metric: input.metric,
        forecastMean: input.forecastMean,
        forecastStdDev: input.forecastStdDev,
        bucketCount: input.buckets.length,
        totalBucketCount: input.totalBucketCount,
        ruleId: input.ruleId,
        recordedAt,
      });

      if (input.buckets.length > 0) {
        await em.getRepository(WeatherBucketTick).insert(
          input.buckets.map((b) => ({
            snapshotId: snapshot.id,
            city: input.city,
            cityNormalized: input.cityNormalized,
            targetDateIso: input.targetDateIso,
            metric: input.metric,
            fidelityMinutes: input.fidelityMinutes,
            conditionId: b.conditionId,
            eventSlug: b.eventSlug,
            question: b.question,
            bucketComparison: b.bucketComparison,
            bucketTarget: b.bucketTarget,
            bucketLow: b.bucketLow,
            bucketHigh: b.bucketHigh,
            yesPrice: b.yesPrice,
            noPrice: b.noPrice,
            yesTokenId: b.yesTokenId,
            noTokenId: b.noTokenId,
            volume: b.volume,
            volume24hr: b.volume24hr,
            liquidityClob: b.liquidityClob,
            acceptingOrders: b.acceptingOrders,
            closed: b.closed,
            endDate: b.endDate,
            recordedAt,
          })),
        );
      }

      return { snapshotId: snapshot.id };
    });
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    const result = await this.ds
      .getRepository(WeatherMarketSnapshot)
      .createQueryBuilder()
      .delete()
      .where('recorded_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
