import { type PnlTick, type Position } from '../../lib/position';
import type { MarketTick } from '../../lib/market';
import { ClosedPositionRow } from './ClosedPositionRow';
import { AwaitingRedemptionPositionRow } from './AwaitingRedemptionPositionRow';
import { OpenPositionRow } from './OpenPositionRow';
import { PositionListBody } from './PositionListBody';
import { PositionListFrame } from './PositionListFrame';
import type { PositionListBaseProps } from './types';

interface OpenLikeProps extends PositionListBaseProps {
  pnlMap: () => Record<number, PnlTick>;
  marketTickMap: () => Record<string, MarketTick>;
  now: () => number;
  onClose: (id: number) => void;
  onOpenMarketMetrics: (pos: Position) => void;
}

function OpenLikePositionsList(props: OpenLikeProps) {
  return (
    <PositionListFrame
      layout={props.layout}
      mode={props.mode}
      positions={props.positions}
      pnlMap={props.pnlMap}
      renderRows={({ positions, hideMarketLink, hideMarketChartTrigger }) => (
        <PositionListBody positions={positions}>
          {(pos) => (
            <OpenPositionRow
              pos={pos}
              tick={() => props.pnlMap()[pos.id]}
              marketTick={() => props.marketTickMap()[pos.assetId]}
              now={props.now}
              onClose={props.onClose}
              onOpenMarketMetrics={props.onOpenMarketMetrics}
              hideMarketLink={hideMarketLink}
              hideMarketChartTrigger={hideMarketChartTrigger}
            />
          )}
        </PositionListBody>
      )}
    />
  );
}

export const OpenPositionsList = OpenLikePositionsList;
export const FailedPositionsList = OpenLikePositionsList;

interface AwaitingRedemptionProps extends PositionListBaseProps {
  pnlMap: () => Record<number, PnlTick>;
  now: () => number;
}

export function AwaitingRedemptionPositionsList(props: AwaitingRedemptionProps) {
  return (
    <PositionListFrame
      layout={props.layout}
      mode={props.mode}
      positions={props.positions}
      pnlMap={props.pnlMap}
      renderRows={({ positions, hideMarketLink, hideMarketChartTrigger }) => (
        <PositionListBody positions={positions}>
          {(pos) => (
            <AwaitingRedemptionPositionRow
              pos={pos}
              tick={() => props.pnlMap()[pos.id]}
              now={props.now}
              hideMarketLink={hideMarketLink}
              hideMarketChartTrigger={hideMarketChartTrigger}
            />
          )}
        </PositionListBody>
      )}
    />
  );
}

export function ClosedPositionsList(props: PositionListBaseProps) {
  return (
    <PositionListFrame
      layout={props.layout}
      mode={props.mode}
      positions={props.positions}
      realized
      renderRows={({ positions, hideMarketLink, hideMarketChartTrigger }) => (
        <PositionListBody positions={positions}>
          {(pos) => (
            <ClosedPositionRow
              pos={pos}
              hideMarketLink={hideMarketLink}
              hideMarketChartTrigger={hideMarketChartTrigger}
            />
          )}
        </PositionListBody>
      )}
    />
  );
}
