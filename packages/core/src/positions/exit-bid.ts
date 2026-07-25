import type { DataSource, EntityManager } from 'typeorm';
import { Execution } from '../entities/Execution.js';

/**
 * Fill price of the last successful SELL execution (exit price) per position.
 * Used by position list enrichment and surveillance chart overlays.
 */
export async function resolveClosedExitBidVwap(
  ds: DataSource,
  positionIds: number[],
  manager?: EntityManager,
): Promise<Map<number, number>> {
  if (positionIds.length === 0) return new Map();

  const rows = await (manager ?? ds.manager)
    .getRepository(Execution)
    .createQueryBuilder('e')
    .select('e.copied_position_id', 'copiedPositionId')
    .addSelect('e.fill_price', 'fillPrice')
    .where('e.copied_position_id IN (:...ids)', { ids: positionIds })
    .andWhere('e.side = :side', { side: 'SELL' })
    .andWhere('e.status IN (:...statuses)', {
      statuses: ['filled', 'partial'],
    })
    .andWhere('e.fill_price IS NOT NULL')
    .andWhere('e.fill_price > 0')
    .orderBy('e.id', 'DESC')
    .getRawMany<{ copiedPositionId: number; fillPrice: number }>();

  const map = new Map<number, number>();
  for (const row of rows) {
    const id = Number(row.copiedPositionId);
    if (!map.has(id)) map.set(id, row.fillPrice);
  }
  return map;
}
