import type { DataSource } from 'typeorm';
import pino from 'pino';
import { AlgoPriceTick } from '../entities/AlgoPriceTick.js';
import {
  metricFieldsFromInput,
  metricsDtoFromEntity,
} from '../lib/algo-price-tick-mappers.js';
import type {
  AlgoPriceTickDto,
  AlgoPriceTickRecordInput,
} from '../lib/algo-price-tick.types.js';

export type {
  AlgoChartTickUpdate,
  AlgoPriceTickDto,
  AlgoPriceTickMetricsDto,
  AlgoPriceTickRecordInput,
} from '../lib/algo-price-tick.types.js';

const log = pino({ name: 'algo-price-tick' });

function toDto(row: AlgoPriceTick): AlgoPriceTickDto {
  return {
    conditionId: row.conditionId,
    upPrice: row.upPrice,
    downPrice: row.downPrice,
    recordedAt:
      row.recordedAt instanceof Date
        ? row.recordedAt.toISOString()
        : new Date(row.recordedAt).toISOString(),
    metrics: metricsDtoFromEntity(row),
  };
}

export class AlgoPriceTickService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(AlgoPriceTick);
  }

  async recordTick(input: AlgoPriceTickRecordInput): Promise<void> {
    try {
      const row = this.repo().create({
        conditionId: input.conditionId,
        upPrice: input.upPrice,
        downPrice: input.downPrice,
        ...metricFieldsFromInput(input),
        recordedAt: input.recordedAt != null ? new Date(input.recordedAt) : new Date(),
      });
      await this.repo().save(row);
    } catch (err) {
      log.warn({ err, conditionId: input.conditionId }, 'failed to record price tick');
    }
  }

  async listTicks(
    conditionId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<AlgoPriceTickDto[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 5000, 10000));
    const qb = this.repo()
      .createQueryBuilder('t')
      .where('t.condition_id = :conditionId', { conditionId })
      .orderBy('t.recorded_at', 'ASC')
      .take(limit);

    if (options?.from) {
      qb.andWhere('t.recorded_at >= :from', { from: options.from });
    }
    if (options?.to) {
      qb.andWhere('t.recorded_at <= :to', { to: options.to });
    }

    const rows = await qb.getMany();
    return rows.map(toDto);
  }

  async deleteOlderThan(maxAgeMs: number): Promise<number> {
    const deadline = new Date(Date.now() - maxAgeMs);
    const result = await this.repo()
      .createQueryBuilder()
      .delete()
      .where('recorded_at < :deadline', { deadline })
      .execute();
    return result.affected ?? 0;
  }
}
