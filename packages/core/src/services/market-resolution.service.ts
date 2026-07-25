import type { DataSource } from 'typeorm';
import type { CopiedPosition } from '../entities/CopiedPosition.js';
import {
  getRedemptionPayoff,
  isMarketRedeemable,
  marketLifecycleFromGamma,
} from '../market/lifecycle.js';
import { getMaxPreCloseSeconds } from '../risk/policy.js';
import { CopiedPositionService } from './copied-position.service.js';
import {
  MarketService,
  shouldPollMarketForLifecycle,
} from './market.service.js';
import { MarketPriceHistorySyncService } from './market-price-history-sync.service.js';
import { RiskService } from './risk.service.js';

export interface PendingResolutionMark {
  copiedPositionId: number;
  conditionId: string;
  winningTokenId: string;
  won: boolean;
}

function groupPositionsByCondition(
  positions: CopiedPosition[],
): Map<string, CopiedPosition[]> {
  const byCondition = new Map<string, CopiedPosition[]>();
  for (const pos of positions) {
    const list = byCondition.get(pos.conditionId) ?? [];
    list.push(pos);
    byCondition.set(pos.conditionId, list);
  }
  return byCondition;
}

export class MarketResolutionService {
  private positionService: CopiedPositionService;
  private marketService: MarketService;
  private riskService: RiskService;
  private syncService: MarketPriceHistorySyncService;

  constructor(private readonly ds: DataSource) {
    this.positionService = new CopiedPositionService(ds);
    this.marketService = new MarketService(ds);
    this.riskService = new RiskService(ds);
    this.syncService = new MarketPriceHistorySyncService(ds);
  }

  async processResolvablePositions(): Promise<PendingResolutionMark[]> {
    const positions = await this.positionService.loadResolvable();
    if (positions.length === 0) return [];

    const byCondition = groupPositionsByCondition(positions);
    const stored = await this.marketService.loadByConditionIds([
      ...byCondition.keys(),
    ]);
    const risk = await this.riskService.getConfig();
    const preCloseSeconds = getMaxPreCloseSeconds(risk);
    const marked: PendingResolutionMark[] = [];

    for (const [conditionId, posList] of byCondition) {
      if (
        !shouldPollMarketForLifecycle(
          stored.get(conditionId),
          preCloseSeconds,
        )
      ) {
        continue;
      }

      const marks = await this.processCondition(conditionId, posList);
      marked.push(...marks);
    }

    return marked;
  }

  private async processCondition(
    conditionId: string,
    posList: CopiedPosition[],
  ): Promise<PendingResolutionMark[]> {
    const fetched = await this.marketService.fetchAndPersist(conditionId);
    if (!fetched?.winningTokenId) return [];

    const endDate = fetched.endDate ? new Date(fetched.endDate) : null;
    if (!isMarketRedeemable(marketLifecycleFromGamma(fetched, endDate))) {
      return [];
    }

    // Market is resolved — mark all price-history sync entries as terminal
    // so the syncer stops polling this market.
    await this.syncService.markTerminalForCondition(conditionId);

    const winningTokenId = fetched.winningTokenId;
    const marked: PendingResolutionMark[] = [];
    for (const pos of posList) {
      const updated = await this.positionService.markPendingResolution(
        pos.id,
        winningTokenId,
        conditionId,
      );
      if (updated) {
        marked.push({
          copiedPositionId: pos.id,
          conditionId,
          winningTokenId,
          won: getRedemptionPayoff(winningTokenId, pos.assetId) === 1,
        });
      }
    }
    return marked;
  }
}
