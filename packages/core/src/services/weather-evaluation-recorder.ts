import pino from 'pino';
import type { DataSource } from 'typeorm';
import { WeatherEvaluationLog } from '../entities/WeatherEvaluationLog.js';

const log = pino({ name: 'core:weather-evaluation-recorder' });
const BATCH_SIZE = 5_000;

export interface EvaluationLogInput {
  snapshotId: number | null;
  conditionId: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  strategyId: string;
  yesPrice: number | null;
  forecastProb: number | null;
  edge: number | null;
  dynamicMinEdge: number | null;
  decision: 'signal' | 'abstain';
  reason: string | null;
}

export class WeatherEvaluationRecorder {
  constructor(private readonly ds: DataSource) {}

  async recordBatch(inputs: EvaluationLogInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const evaluatedAt = new Date();
    await this.ds.getRepository(WeatherEvaluationLog).insert(
      inputs.map((input) => ({ ...input, evaluatedAt })),
    );
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    let totalDeleted = 0;

    for (;;) {
      const rows = await this.ds
        .getRepository(WeatherEvaluationLog)
        .createQueryBuilder('e')
        .select('e.id', 'id')
        .where('e.evaluatedAt < :cutoff', { cutoff })
        .orderBy('e.id', 'ASC')
        .limit(BATCH_SIZE)
        .getRawMany<{ id: number }>();

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) break;

      await this.ds
        .getRepository(WeatherEvaluationLog)
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids })
        .execute();

      totalDeleted += ids.length;
      if (ids.length < BATCH_SIZE) break;
    }

    if (totalDeleted > 0) {
      log.info({ deletedRows: totalDeleted, cutoff }, 'purged weather_evaluation_log');
    }
    return totalDeleted;
  }
}
