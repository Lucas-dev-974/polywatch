import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';

import { MarketMetricsPanel } from './MarketMetricsPanel';

import { CollapsiblePanel, useCollapse } from './CollapsiblePanel';
import { Icon } from './Icon';

import { api } from '../api';
import { useClock } from '../hooks/useClock';
import {
  partitionActivePositions,
  summarizePositionsPnl,
  type PnlTick,
  type Position,
} from '../lib/position';
import type { MarketTick } from '../lib/market';
import { connectSocket, onGlobalRefresh } from '../socket';
import {
  AwaitingRedemptionPositionsList,
  ClosedPositionsList,
  FailedPositionsList,
  OpenPositionsList,
} from './position/PositionList';
import { PositionListLayoutToggle } from './position/PositionListLayoutToggle';
import { POSITION_LIST_LAYOUTS, POSITION_TABS, UI_KEYS, usePersistedEnum } from '../lib/ui-persistence';
import {
  positionCountLabel,
  PositionTabsBar,
  type PositionTab,
} from './position/PositionTabsBar';

/** Fallback REST poll when WS ticks are absent (ms). */
const POSITION_POLL_INTERVAL_MS = 60_000;

type Props = {
  mode: 'sim' | 'real';
};

function EmptyState(props: { message: string }) {
  return (
    <div class="empty-state">
      <div class="empty-state-icon">◈</div>
      {props.message}
    </div>
  );
}

export function PositionCard(props: Props) {
  const [tab, setTab] = usePersistedEnum<PositionTab>(
    UI_KEYS.positionsTab(props.mode),
    'open',
    POSITION_TABS,
  );
  const [listLayout, setListLayout] = usePersistedEnum(
    UI_KEYS.positionsListLayout(props.mode),
    'split',
    POSITION_LIST_LAYOUTS,
  );
  const [collapsed, setCollapsed] = useCollapse('positions', props.mode);
  const [activePositions, setActivePositions] = createSignal<Position[]>([]);
  const [closedPositions, setClosedPositions] = createSignal<Position[]>([]);
  const [pnlMap, setPnlMap] = createSignal<Record<number, PnlTick>>({});
  const [marketTickMap, setMarketTickMap] = createSignal<Record<string, MarketTick>>({});
  const [metricsPosition, setMetricsPosition] = createSignal<Position | null>(null);
  const now = useClock();

  const partitioned = createMemo(() =>
    partitionActivePositions(activePositions(), now()),
  );
  const openPositions = () => partitioned().open;
  const awaitingRedemptionPositions = () => partitioned().awaitingRedemption;
  const failedPositions = () => partitioned().failed;

  async function loadActive() {
    setActivePositions(
      await api<Position[]>(
        `/copied-positions?status=open,closing,pending_resolution,failed&mode=${props.mode}`,
      ),
    );
  }

  async function loadHistory() {
    setClosedPositions(
      await api<Position[]>(`/copied-positions?status=closed&mode=${props.mode}`),
    );
  }

  async function loadAll() {
    await Promise.all([loadActive(), loadHistory()]);
  }

  onMount(() => {
    void loadAll();

    const socket = connectSocket();

    const onPnlTick = (tick: PnlTick) => {
      setPnlMap((prev) => ({ ...prev, [tick.copiedPositionId]: tick }));
    };
    const onMarketTick = (tick: MarketTick) => {
      setMarketTickMap((prev) => ({ ...prev, [tick.assetId]: tick }));
    };
    const onSimulationReset = () => {
      if (props.mode === 'sim') {
        setPnlMap({});
      }
    };

    socket.on('pnl_tick', onPnlTick);
    socket.on('market_tick', onMarketTick);
    socket.on('simulation_reset', onSimulationReset);

    // Coalesce position_update / execution / simulation_reset bursts into one refresh.
    const unsubscribeRefresh = onGlobalRefresh(() => void loadAll());

    // Fallback REST poll only when the real-time socket is not connected.
    const pollId =
      socket.connected
        ? null
        : setInterval(() => void loadAll(), POSITION_POLL_INTERVAL_MS);

    onCleanup(() => {
      socket.off('pnl_tick', onPnlTick);
      socket.off('market_tick', onMarketTick);
      socket.off('simulation_reset', onSimulationReset);
      unsubscribeRefresh();
      if (pollId != null) clearInterval(pollId);
    });
  });

  async function closePosition(id: number) {
    await api(`/copied-positions/${id}/close`, { method: 'POST' });
    await loadAll();
  }

  const visiblePositions = () => {
    if (tab() === 'history') return closedPositions();
    if (tab() === 'redemption') return awaitingRedemptionPositions();
    if (tab() === 'failed') return failedPositions();
    return openPositions();
  };

  const activeSummary = () =>
    summarizePositionsPnl(visiblePositions(), pnlMap(), tab() === 'history');

  return (
    <>
      <section class="panel">
      <div class="panel-header">
        <h2>Positions</h2>
        <div class="panel-header-actions">
          <span class="panel-count">
            {positionCountLabel(
              tab(),
              openPositions().length,
              awaitingRedemptionPositions().length,
              failedPositions().length,
              closedPositions().length,
            )}
          </span>
          <PositionListLayoutToggle
            layout={listLayout()}
            onToggle={() =>
              setListLayout(listLayout() === 'split' ? 'flat' : 'split')
            }
          />
          <button
            class="panel-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed() ? 'Déplier' : 'Plier'}
          >
            <Icon name={collapsed() ? 'chevron-down' : 'chevron-up'} />
          </button>
        </div>
      </div>

      <PositionTabsBar
        tab={tab()}
        summary={activeSummary()}
        mode={props.mode}
        onTabChange={setTab}
      />

      <CollapsiblePanel collapsed={collapsed()}>
        <div
          classList={{
            'panel-body-flush': true,
            'panel-scroll': listLayout() === 'flat',
          }}
        >
          <Show when={tab() === 'open'}>
            <Show
              when={openPositions().length > 0}
              fallback={<EmptyState message="Aucune position ouverte" />}
            >
              <OpenPositionsList
                mode={props.mode}
                layout={listLayout()}
                positions={openPositions()}
                pnlMap={pnlMap}
                marketTickMap={marketTickMap}
                now={now}
                onClose={(id) => void closePosition(id)}
                onOpenMarketMetrics={setMetricsPosition}
              />
            </Show>
          </Show>

          <Show when={tab() === 'redemption'}>
            <Show
              when={awaitingRedemptionPositions().length > 0}
              fallback={
                <EmptyState message="Aucune position en attente de rédemption" />
              }
            >
              <AwaitingRedemptionPositionsList
                mode={props.mode}
                layout={listLayout()}
                positions={awaitingRedemptionPositions()}
                pnlMap={pnlMap}
                now={now}
              />
            </Show>
          </Show>

          <Show when={tab() === 'history'}>
            <Show
              when={closedPositions().length > 0}
              fallback={<EmptyState message="Aucune position clôturée" />}
            >
              <ClosedPositionsList
                mode={props.mode}
                layout={listLayout()}
                positions={closedPositions()}
              />
            </Show>
          </Show>

          <Show when={tab() === 'failed'}>
            <Show
              when={failedPositions().length > 0}
              fallback={<EmptyState message="Aucune position échouée" />}
            >
              <FailedPositionsList
                mode={props.mode}
                layout={listLayout()}
                positions={failedPositions()}
                pnlMap={pnlMap}
                marketTickMap={marketTickMap}
                now={now}
                onClose={(id) => void closePosition(id)}
                onOpenMarketMetrics={setMetricsPosition}
              />
            </Show>
          </Show>
        </div>
      </CollapsiblePanel>
    </section>
    <Show when={metricsPosition()}>
      {(pos) => (
        <MarketMetricsPanel
          open
          onClose={() => setMetricsPosition(null)}
          pos={pos()}
          liveTick={() => marketTickMap()[pos().assetId]}
        />
      )}
    </Show>
    </>
  );
}
