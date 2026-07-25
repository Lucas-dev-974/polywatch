import type { DataSource } from 'typeorm';
import { CopiedPositionService, type CopiedPosition, type TradingMode } from '@polywatch/core';

export async function findOpenPosition(
  ds: DataSource,
  watchlistId: number,
  conditionId: string,
  assetId: string,
  mode: TradingMode,
): Promise<CopiedPosition | null> {
  return new CopiedPositionService(ds).findOpenByMarket(
    watchlistId,
    conditionId,
    assetId,
    mode,
  );
}

export async function findPendingEntryForMove(
  ds: DataSource,
  watchlistId: number,
  conditionId: string,
  assetId: string,
  mode: TradingMode,
  moveEventId: string,
): Promise<CopiedPosition | null> {
  return new CopiedPositionService(ds).findPendingEntryForMove(
    watchlistId,
    conditionId,
    assetId,
    mode,
    moveEventId,
  );
}

export async function hasBlockingActivePosition(
  ds: DataSource,
  watchlistId: number,
  conditionId: string,
  assetId: string,
  mode: TradingMode,
  moveEventId: string,
): Promise<boolean> {
  return new CopiedPositionService(ds).hasBlockingActivePosition(
    watchlistId,
    conditionId,
    assetId,
    mode,
    moveEventId,
  );
}
