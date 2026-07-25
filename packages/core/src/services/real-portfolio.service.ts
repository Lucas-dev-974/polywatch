import type { EntityManager } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { RealSession } from '../entities/RealSession.js';
import { marketLifecycleFromEntity } from '../market/lifecycle.js';
import {
  computePositionUnrealizedPnl,
  OPEN_LIKE_POSITION_STATUSES,
  sumOpenPositionsValue,
} from '../positions/mark.js';
import { MarketService } from './market.service.js';

export interface RealPortfolioSnapshot {
  amount: number;
  token: string;
  positionsValue: number;
  equity: number;
  openPnlSum: number;
  closedPnlSum: number;
  baselineCapital: number;
}

export class RealPortfolioService {
  private marketService: MarketService;

  constructor(private readonly ds: import('typeorm').DataSource) {
    this.marketService = new MarketService(ds);
  }

  /**
   * Build an observation-only portfolio snapshot for real mode.
   * Cash is supplied by the caller (wallet fetch); baseline comes from the active session.
   */
  async getSnapshot(
    manager: EntityManager,
    observedCash: number,
  ): Promise<RealPortfolioSnapshot> {
    const session = await manager.getRepository(RealSession).findOne({
      where: { status: 'active' },
      order: { id: 'DESC' },
    });
    const baselineCapital = session?.baselineCapital ?? 0;

    const openLikePositions = await manager.getRepository(CopiedPosition).find({
      where: OPEN_LIKE_POSITION_STATUSES.map((status) => ({
        mode: 'real' as const,
        status,
      })),
    });

    const closedPositions = await manager.getRepository(CopiedPosition).find({
      where: { mode: 'real', status: 'closed' },
    });

    const conditionIds = [...new Set(openLikePositions.map((p) => p.conditionId))];
    const marketRows = await this.marketService.loadByConditionIds(conditionIds);
    const lifecycleByCondition = new Map(
      [...marketRows.entries()].map(([id, m]) => [
        id,
        marketLifecycleFromEntity(m),
      ]),
    );

    const positionsValue = sumOpenPositionsValue(
      openLikePositions,
      lifecycleByCondition,
    );

    const openPnlSum = openLikePositions.reduce((sum, p) => {
      const market = lifecycleByCondition.get(p.conditionId);
      return sum + computePositionUnrealizedPnl(p, market ?? null);
    }, 0);

    const closedPnlSum = closedPositions.reduce(
      (sum, p) => sum + (p.realizedPnl ?? 0),
      0,
    );

    return {
      amount: observedCash,
      token: 'USDC',
      positionsValue,
      equity: observedCash + positionsValue,
      openPnlSum,
      closedPnlSum,
      baselineCapital,
    };
  }
}
