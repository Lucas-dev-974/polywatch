import pino from 'pino';
import type { DataSource } from 'typeorm';
import { MarketPriceTick } from '../entities/MarketPriceTick.js';

const log = pino({ name: 'market-price-tick' });

export interface MarketPriceTickDto {
  conditionId: string;
  assetId: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  executableBidVwap: number | null;
  executableAskVwap: number | null;
  lastTradePrice: number | null;
  recordedAt: string;
}

function toDto(row: MarketPriceTick): MarketPriceTickDto {
  return {
    conditionId: row.conditionId,
    assetId: row.assetId,
    bestBid: row.bestBid,
    bestAsk: row.bestAsk,
    midPrice: row.midPrice,
    spread: row.spread,
    spreadPercent: row.spreadPercent,
    executableBidVwap: row.executableBidVwap,
    executableAskVwap: row.executableAskVwap,
    lastTradePrice: row.lastTradePrice,
    recordedAt:
      row.recordedAt instanceof Date
        ? row.recordedAt.toISOString()
        : new Date(row.recordedAt).toISOString(),
  };
}

export class MarketPriceTickService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(MarketPriceTick);
  }

  async listTicks(
    conditionId: string,
    options?: { from?: Date; to?: Date; limit?: number; assetId?: string },
  ): Promise<MarketPriceTickDto[]> {
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
    if (options?.assetId) {
      qb.andWhere('t.asset_id = :assetId', { assetId: options.assetId });
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

  async upsertBatch(
    conditionId: string,
    assetId: string,
    points: { t: number; p: number }[],
  ): Promise<{ attempted: number }> {
    if (points.length === 0) return { attempted: 0 };

    const CHUNK_SIZE = 500;

    for (let i = 0; i < points.length; i += CHUNK_SIZE) {
      const chunk = points.slice(i, i + CHUNK_SIZE);
      const rows = chunk.map((pt) => ({
        conditionId,
        assetId,
        bestBid: null,
        bestAsk: null,
        midPrice: pt.p,
        spread: null,
        spreadPercent: null,
        executableBidVwap: null,
        executableAskVwap: null,
        lastTradePrice: null,
        recordedAt: new Date(pt.t * 1000),
      }));

      try {
        await this.repo()
          .createQueryBuilder()
          .insert()
          .values(rows)
          .orIgnore()
          .execute();
      } catch (err) {
        log.warn(
          { err, conditionId, assetId, chunkStart: i },
          'upsertBatch chunk failed',
        );
      }
    }

    return { attempted: points.length };
  }

  async getLatestTickTs(
    conditionId: string,
    assetId: string,
  ): Promise<number | null> {
    const row = await this.repo()
      .createQueryBuilder('t')
      .select('t.recorded_at')
      .where('t.condition_id = :conditionId', { conditionId })
      .andWhere('t.asset_id = :assetId', { assetId })
      .orderBy('t.recorded_at', 'DESC')
      .getOne();

    if (!row) return null;
    return Math.floor(row.recordedAt.getTime() / 1000);
  }
}
