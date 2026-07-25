import type { DataSource } from 'typeorm';
import {
  CopiedPosition,
  MarketService,
  ZERO_PLATFORM_FEE,
  type PlatformFeeParams,
} from '@polywatch/core';

/** Resolves platform fee params (fd.r / fd.e) for a position's market. */
export async function resolvePlatformFeeParams(
  ds: DataSource,
  copiedPositionId: number,
): Promise<PlatformFeeParams> {
  const pos = await ds.getRepository(CopiedPosition).findOne({
    where: { id: copiedPositionId },
  });
  if (!pos?.conditionId) {
    return ZERO_PLATFORM_FEE;
  }

  return new MarketService(ds).resolvePlatformFeeParams(pos.conditionId);
}
