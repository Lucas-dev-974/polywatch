import type { DataSource, SelectQueryBuilder } from 'typeorm';
import pino from 'pino';
import { MarketPositionTick } from '../entities/MarketPositionTick.js';

const log = pino({ name: 'market-position-tick-service' });

export interface RecordMarketTickInput {
  copiedPositionId: number;
  conditionId: string;
  assetId: string;
  outcome: string;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  executableBidVwap?: number | null;
  executableAskVwap?: number | null;
  lastTradePrice?: number | null;
}

export interface ListTicksOptions {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}

const MAX_LIMIT = 10_000;

export class MarketPositionTickService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(MarketPositionTick);
  }

  async recordTick(input: RecordMarketTickInput): Promise<MarketPositionTick> {
    const entity = this.repo().create({
      copiedPositionId: input.copiedPositionId,
      conditionId: input.conditionId,
      assetId: input.assetId,
      outcome: input.outcome,
      bestBid: input.bestBid,
      bestAsk: input.bestAsk,
      midPrice: input.midPrice,
      spread: input.spread,
      spreadPercent: input.spreadPercent,
      executableBidVwap: input.executableBidVwap ?? null,
      executableAskVwap: input.executableAskVwap ?? null,
      lastTradePrice: input.lastTradePrice ?? null,
    });
    return this.repo().save(entity);
  }

  async recordBatch(inputs: RecordMarketTickInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const rows = inputs.map((input) =>
      this.repo().create({
        copiedPositionId: input.copiedPositionId,
        conditionId: input.conditionId,
        assetId: input.assetId,
        outcome: input.outcome,
        bestBid: input.bestBid,
        bestAsk: input.bestAsk,
        midPrice: input.midPrice,
        spread: input.spread,
        spreadPercent: input.spreadPercent,
        executableBidVwap: input.executableBidVwap ?? null,
        executableAskVwap: input.executableAskVwap ?? null,
        lastTradePrice: input.lastTradePrice ?? null,
      }),
    );
    await this.repo().insert(rows);
  }

  async listByPosition(
    copiedPositionId: number,
    options: ListTicksOptions = {},
  ): Promise<{ items: MarketPositionTick[]; total: number }> {
    const limit = this.clampLimit(options.limit ?? 1_000);
    const offset = Math.max(0, options.offset ?? 0);

    const qb = this.repo()
      .createQueryBuilder('t')
      .where('t.copiedPositionId = :copiedPositionId', { copiedPositionId })
      .orderBy('t.createdAt', 'DESC')
      .addOrderBy('t.id', 'DESC');

    this.applyDateFilters(qb, options);

    const [items, total] = await qb.skip(offset).take(limit).getManyAndCount();
    return { items, total };
  }

  async listByMarket(
    conditionId: string,
    options: ListTicksOptions & { copiedPositionId?: number } = {},
  ): Promise<{ items: MarketPositionTick[]; total: number }> {
    const limit = this.clampLimit(options.limit ?? 1_000);
    const offset = Math.max(0, options.offset ?? 0);

    const qb = this.repo()
      .createQueryBuilder('t')
      .where('t.conditionId = :conditionId', { conditionId })
      .orderBy('t.createdAt', 'DESC')
      .addOrderBy('t.id', 'DESC');

    if (options.copiedPositionId != null) {
      qb.andWhere('t.copiedPositionId = :copiedPositionId', {
        copiedPositionId: options.copiedPositionId,
      });
    }

    this.applyDateFilters(qb, options);

    const [items, total] = await qb.skip(offset).take(limit).getManyAndCount();
    return { items, total };
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    const BATCH_SIZE = 5_000;
    let totalDeleted = 0;

    for (;;) {
    const rows = await this.repo()
      .createQueryBuilder('t')
      .select('t.id', 'id')
      .where('t.createdAt < :cutoff', { cutoff })
      .orderBy('t.id', 'ASC')
      .limit(BATCH_SIZE)
      .getRawMany<{ id: number }>();

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) break;

      await this.repo()
        .createQueryBuilder()
        .delete()
        .from(MarketPositionTick)
        .where('id IN (:...ids)', { ids })
        .execute();

      totalDeleted += ids.length;
      if (ids.length < BATCH_SIZE) break;
    }

    if (totalDeleted > 0) {
      log.info({ deletedRows: totalDeleted, cutoff }, 'purged old market position ticks');
    }
    return totalDeleted;
  }

  private clampLimit(limit: number): number {
    return Math.max(1, Math.min(limit, MAX_LIMIT));
  }

  private applyDateFilters(
    qb: SelectQueryBuilder<MarketPositionTick>,
    options: ListTicksOptions,
  ): void {
    if (options.from) {
      qb.andWhere('t.createdAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('t.createdAt <= :to', { to: options.to });
    }
  }
}
