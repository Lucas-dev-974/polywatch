import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from 'solid-js';

import { useHorizontalResize } from '../../hooks/useHorizontalResize';
import {
  groupPositionsByMarket,
  marketGroupPnl,
  type PnlTick,
  type Position,
} from '../../lib/position';
import {
  UI_KEYS,
  type UiMode,
  usePersistedSignal,
} from '../../lib/ui-persistence';
import { MarketIcon } from './MarketIcon';
import { PositionMarketLink } from './PositionMarketLink';
import { PositionMarketNavItem } from './PositionMarketNavItem';
import { PositionMarketChartTrigger } from '../PositionMarketChartTrigger';

const NAV_WIDTH_MIN = 160;
const NAV_WIDTH_MAX = 520;
const NAV_WIDTH_DEFAULT = 260;

interface Props {
  mode: UiMode;
  positions: Position[];
  pnlMap?: () => Record<number, PnlTick>;
  realized?: boolean;
  renderList: (positions: () => Position[]) => JSX.Element;
}

export function PositionMarketSplitView(props: Props) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [navWidth, setNavWidth] = usePersistedSignal(
    UI_KEYS.positionsMarketNavWidth(props.mode),
    NAV_WIDTH_DEFAULT,
    (value): value is number =>
      typeof value === 'number' &&
      value >= NAV_WIDTH_MIN &&
      value <= NAV_WIDTH_MAX,
  );

  const groups = createMemo(() => groupPositionsByMarket(props.positions));

  createEffect(() => {
    const list = groups();
    const current = selectedId();
    if (list.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!current || !list.some((g) => g.conditionId === current)) {
      setSelectedId(list[0]!.conditionId);
    }
  });

  const displayedMarket = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    return groups().find((g) => g.conditionId === id) ?? null;
  });

  const displayedPositions = createMemo(
    () => displayedMarket()?.positions ?? [],
  );

  const showNavPnl = () => props.pnlMap != null || props.realized;

  const groupNetPnl = (positions: Position[]) => {
    const map = props.pnlMap?.() ?? {};
    return marketGroupPnl(positions, map, props.realized ?? false);
  };

  const { startResize } = useHorizontalResize({
    width: navWidth,
    setWidth: setNavWidth,
    min: NAV_WIDTH_MIN,
    max: () => NAV_WIDTH_MAX,
  });

  return (
    <div
      class="position-market-split"
      style={{ '--position-market-nav-width': `${navWidth()}px` }}
    >
      <nav class="position-market-nav" aria-label="Marchés">
        <For each={groups()}>
          {(group) => (
            <PositionMarketNavItem
              group={group}
              net={() => groupNetPnl(group.positions)}
              isActive={() => selectedId() === group.conditionId}
              showPnl={showNavPnl()}
              onSelect={() => setSelectedId(group.conditionId)}
            />
          )}
        </For>
      </nav>

      <div
        class="position-market-split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner la liste des marchés"
        aria-valuemin={NAV_WIDTH_MIN}
        aria-valuemax={NAV_WIDTH_MAX}
        aria-valuenow={navWidth()}
        onMouseDown={startResize}
      />

      <div class="position-market-detail">
        <Show when={displayedMarket()}>
          {(market) => (
            <div class="position-market-detail-pane">
              <header class="position-market-detail-header">
                <MarketIcon
                  conditionId={market().conditionId}
                  label={market().label}
                  size={32}
                />
                <PositionMarketLink pos={market().positions[0]!} />
                <PositionMarketChartTrigger
                  pos={market().positions[0]!}
                  buttonClass="btn btn-ghost btn-sm algo-surveillance-chart-btn"
                />
              </header>
              <div class="position-market-detail-list">
                {props.renderList(displayedPositions)}
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
