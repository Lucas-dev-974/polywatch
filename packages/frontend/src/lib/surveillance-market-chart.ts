import type { AlgoSurveillancePositionSummary, AlgoSurveillanceSnapshot } from './algo-surveillance';
import {
  formatSurveillancePositionEntryOffset,
  normalizeSurveillancePositions,
  surveillancePositionDisplayQuantity,
  surveillancePositionStatusLabel,
} from './algo-surveillance-positions';
import type { MarketChartContext, MarketChartPosition } from './market-chart';

export function surveillancePositionToChartPosition(
  pos: AlgoSurveillancePositionSummary,
  marketStartAt: string | null | undefined,
): MarketChartPosition {
  const entryOffset = formatSurveillancePositionEntryOffset(
    pos.openedAt,
    marketStartAt,
  );
  return {
    id: pos.id,
    outcome: pos.outcome,
    mode: pos.mode,
    status: surveillancePositionStatusLabel(pos.status),
    assetId: pos.assetId,
    entryPrice: pos.entryPrice,
    entryBidVwap: pos.entryBidVwap,
    slBidPoints: pos.slBidPoints,
    tpBidPoints: pos.tpBidPoints,
    exitBidVwap: pos.exitBidVwap,
    openedAt: pos.openedAt,
    closedAt: pos.closedAt,
    positionQuantity: surveillancePositionDisplayQuantity(pos),
    entryOffsetLabel: entryOffset,
  };
}

/**
 * Build market-chart context from a surveillance snapshot.
 * @param selectedPositionId — pre-select this position when opening from a row click.
 */
export function surveillanceToMarketChartContext(
  snapshot: AlgoSurveillanceSnapshot,
  selectedPositionId?: number | null,
): MarketChartContext {
  const positions = normalizeSurveillancePositions(snapshot.positions).map((p) =>
    surveillancePositionToChartPosition(p, snapshot.marketStartAt),
  );

  const initialId =
    selectedPositionId != null &&
    positions.some((p) => p.id === selectedPositionId)
      ? selectedPositionId
      : positions[0]?.id ?? null;

  return {
    conditionId: snapshot.conditionId,
    copiedPositionId: initialId,
    chartPositions: positions,
    cryptoSymbol: snapshot.cryptoSymbol,
    interval: snapshot.interval,
    question: snapshot.question,
    marketStartAt: snapshot.marketStartAt,
    marketEndAt: snapshot.marketEndAt,
  };
}
