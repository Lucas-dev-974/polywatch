import { createMemo, Show } from 'solid-js';
import type { useWeatherAlgoPositions, WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import { CollapsibleSection } from './CollapsibleSection';
import { Icon } from './Icon';
import {
  WeatherPositionGroupedList,
} from './weather-position-group/WeatherPositionGroupedList';
import { buildWeatherPositionGroups } from './weather-position-group/buildGroups';

export interface WeatherAlgoPositionsPanelProps {
  positions: ReturnType<typeof useWeatherAlgoPositions>;
}

const MODE_LABELS: Record<'all' | 'live' | 'sim', string> = {
  all: 'Tous',
  live: 'Live',
  sim: 'Sim',
};

function matchesMode(
  pos: WeatherPosition,
  mode: 'all' | 'live' | 'sim',
): boolean {
  return mode === 'all' || pos.mode === mode;
}

export function WeatherAlgoPositionsPanel(props: WeatherAlgoPositionsPanelProps) {
  const p = () => props.positions;

  const openPositions = createMemo(() =>
    p().positions().filter((pos) => matchesMode(pos, p().posModeFilter())),
  );

  const closedList = createMemo(() =>
    p().closedPositions().filter((pos) => matchesMode(pos, p().posModeFilter())),
  );

  const openGroups = createMemo(() => buildWeatherPositionGroups(openPositions()));
  const historyGroups = createMemo(() => buildWeatherPositionGroups(closedList()));

  return (
    <CollapsibleSection
      title="Positions weather-algo"
      persistKey="polywatch_weather_positions_collapsed"
      class="algo-panel-full"
      headerActions={
        <div class="weather-position-header-right">
          <div class="weather-position-tabs">
            <button
              class={`weather-position-tab ${p().posTab() === 'open' ? 'weather-position-tab--active' : ''}`}
              onClick={() => p().selectPosTab('open')}
            >
              Ouvertes ({p().positions().length})
            </button>
            <button
              class={`weather-position-tab ${p().posTab() === 'history' ? 'weather-position-tab--active' : ''}`}
              onClick={() => p().selectPosTab('history')}
            >
              Historique ({p().historyTotal()})
            </button>
          </div>
          <div class="weather-position-mode-tabs">
            <button
              type="button"
              class={`weather-position-mode-tab ${p().posModeFilter() === 'all' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('all')}
            >
              Tous
            </button>
            <button
              type="button"
              class={`weather-position-mode-tab ${p().posModeFilter() === 'live' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('live')}
            >
              Live
            </button>
            <button
              type="button"
              class={`weather-position-mode-tab ${p().posModeFilter() === 'sim' ? 'active' : ''}`}
              onClick={() => p().setPosModeFilter('sim')}
            >
              Sim
            </button>
          </div>
        </div>
      }
    >

      <Show when={p().posTab() === 'open'}>
        <Show when={!p().loading()} fallback={<div class="algo-empty">Chargement…</div>}>
          <Show
            when={openPositions().length > 0}
            fallback={
              <div class="algo-empty">
                Aucune position {p().posModeFilter() === 'all' ? 'ouverte' : `ouverte en mode ${MODE_LABELS[p().posModeFilter()]}`}.
              </div>
            }
          >
            <WeatherPositionGroupedList
              groups={openGroups()}
              onClose={(id) => p().closePosition(id)}
            />
          </Show>
        </Show>
      </Show>

      <Show when={p().posTab() === 'history'}>
        <Show when={!p().loadingHistory()} fallback={<div class="algo-empty">Chargement de l'historique…</div>}>
          <Show
            when={closedList().length > 0}
            fallback={
              <div class="algo-empty">
                Aucune position clôturée
                {p().posModeFilter() !== 'all' ? ` en mode ${MODE_LABELS[p().posModeFilter()]}` : ''}.
              </div>
            }
          >
            <WeatherPositionGroupedList groups={historyGroups()} />
            <div class="algo-pagination-row">
              <Show when={p().historyTotal() > 0}>
                <div class="algo-pagination">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={p().historyPage() === 0}
                    onClick={() => p().goToHistoryPage(p().historyPage() - 1)}
                    aria-label="Page précédente"
                  >
                    <Icon name="chevron-left" size={16} />
                  </button>
                  <span class="algo-pagination-info">
                    {p().historyPage() + 1} / {p().historyPageCount()}
                  </span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={p().historyPage() >= p().historyPageCount() - 1}
                    onClick={() => p().goToHistoryPage(p().historyPage() + 1)}
                    aria-label="Page suivante"
                  >
                    <Icon name="chevron-right" size={16} />
                  </button>
                </div>
              </Show>
              <span class="algo-panel-count">{p().historyTotal()} positions</span>
            </div>
          </Show>
        </Show>
      </Show>
    </CollapsibleSection>
  );
}
