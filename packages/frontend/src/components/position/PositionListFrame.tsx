import { Match, Switch, type JSX } from 'solid-js';

import { type PnlTick, type Position } from '../../lib/position';
import type { PositionListLayout, UiMode } from '../../lib/ui-persistence';
import { PositionMarketSplitView } from './PositionMarketSplitView';

interface Props {
  layout: PositionListLayout;
  mode: UiMode;
  positions: Position[];
  pnlMap?: () => Record<number, PnlTick>;
  realized?: boolean;
  renderRows: (opts: {
    positions: () => Position[];
    hideMarketLink: boolean;
    hideMarketChartTrigger: boolean;
  }) => JSX.Element;
}

export function PositionListFrame(props: Props) {
  const hideMarketLink = () => props.layout === 'split';
  const hideMarketChartTrigger = () => props.layout === 'split';

  const renderList = (positions: () => Position[]) =>
    props.renderRows({
      positions,
      hideMarketLink: hideMarketLink(),
      hideMarketChartTrigger: hideMarketChartTrigger(),
    });

  return (
    <Switch>
      <Match when={props.layout === 'flat'}>
        {renderList(() => props.positions)}
      </Match>
      <Match when={props.layout === 'split'}>
        <PositionMarketSplitView
          mode={props.mode}
          positions={props.positions}
          pnlMap={props.pnlMap}
          realized={props.realized}
          renderList={renderList}
        />
      </Match>
    </Switch>
  );
}
