import { createSignal, For, Show } from 'solid-js';
import { useWeatherAlgoDashboard } from '../hooks/useWeatherAlgoDashboard';
import { useWeatherAlgoPositions } from '../hooks/useWeatherAlgoPositions';
import { useWeatherAlgoExecutions } from '../hooks/useWeatherAlgoExecutions';
import {
  UI_KEYS,
  WEATHER_ALGO_PAGE_TABS,
  usePersistedEnum,
} from '../lib/ui-persistence';
import { WeatherAlgoCapitalHero } from './WeatherAlgoCapitalHero';
import { WeatherAlgoDiscoverPanel } from './WeatherAlgoDiscoverPanel';
import { WeatherAlgoActiveMarketsPanel } from './WeatherAlgoActiveMarketsPanel';
import { WeatherAlgoPositionsPanel } from './WeatherAlgoPositionsPanel';
import { WeatherAlgoExecutionsPanel } from './WeatherAlgoExecutionsPanel';
import { WeatherAlgoAutoTrackTab } from './WeatherAlgoAutoTrackTab';
import { WeatherAlgoHistoryIngestSection } from './WeatherAlgoHistoryIngestSection';
import { WeatherAlgoSettingsTab } from './WeatherAlgoSettingsTab';
import { WeatherAlgoDataTab } from './WeatherAlgoDataTab';
import { WeatherAlgoBacktestTab } from './WeatherAlgoBacktestTab';
import { WeatherAlgoStrategiesTab } from './WeatherAlgoStrategiesTab';
import { NewSessionResetDialog } from './dialogs/NewSessionResetDialog';

export function WeatherAlgoPage() {
  const dashboard = useWeatherAlgoDashboard();
  const positions = useWeatherAlgoPositions();
  const executions = useWeatherAlgoExecutions();
  const [tab, setTab] = usePersistedEnum(
    UI_KEYS.weatherAlgoTab,
    'markets',
    WEATHER_ALGO_PAGE_TABS,
  );
  const [resetDialogOpen, setResetDialogOpen] = createSignal(false);

  return (
    <div class="weather-algo-page">
      <WeatherAlgoCapitalHero
        capital={dashboard.capital()}
        realTradingEnabled={dashboard.realTradingEnabled()}
        weatherAlgoSimEnabled={dashboard.weatherAlgoSimEnabled()}
        weatherAlgoRealEnabled={dashboard.weatherAlgoRealEnabled()}
        onToggleRealTrading={dashboard.toggleRealTrading}
        onResetSim={() => setResetDialogOpen(true)}
      />

      <div class="weather-algo-tabs-row">
        <div class="weather-algo-segmented" role="tablist">
          <For each={[
            { id: 'markets' as const, label: 'Marchés' },
            { id: 'positions' as const, label: 'Positions' },
            { id: 'cities' as const, label: 'Villes' },
            { id: 'data' as const, label: 'Données' },
            { id: 'backtest' as const, label: 'Backtest' },
            { id: 'strategies' as const, label: 'Stratégies' },
            { id: 'settings' as const, label: 'Paramètres' },
          ]}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === item.id}
                class={`weather-algo-segmented-btn${tab() === item.id ? ' active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <Show when={dashboard.status()}>
          {(s) => (
            <span class={`algo-status-badge ${s().alive ? 'alive' : 'stopped'}`}>
              <span class="algo-status-dot" />
              {s().alive ? 'En ligne' : 'Arrêté'}
            </span>
          )}
        </Show>
      </div>

      <Show when={tab() === 'markets'}>
        <div class="weather-algo-grid">
          <WeatherAlgoActiveMarketsPanel
            rules={dashboard.autoTrackRules()}
            onToggle={dashboard.toggleAutoTrackRule}
            onRemove={dashboard.removeAutoTrackRule}
          />
          <WeatherAlgoDiscoverPanel
            groups={dashboard.discoverGroups()}
            loading={dashboard.discoverLoading()}
            watchedCities={dashboard.watchedCitySet()}
            onRefresh={dashboard.discoverMarkets}
            onWatchCity={(city) => void dashboard.watchCity(city)}
          />
        </div>
      </Show>

      <Show when={tab() === 'positions'}>
        <div class="weather-algo-stack">
          <WeatherAlgoPositionsPanel positions={positions} />
          <WeatherAlgoExecutionsPanel executions={executions} />
        </div>
      </Show>

      <Show when={tab() === 'cities'}>
        <div class="weather-algo-stack">
          <WeatherAlgoAutoTrackTab
            rules={dashboard.autoTrackRules()}
            onAdd={(city, lookAheadDays) => void dashboard.watchCity(city, lookAheadDays)}
            onRemove={dashboard.removeAutoTrackRule}
            onToggle={dashboard.toggleAutoTrackRule}
            onUpdateLookAhead={(id, lookAheadDays) =>
              void dashboard.updateAutoTrackLookAhead(id, lookAheadDays)
            }
            onUpdateAllLookAhead={(lookAheadDays) =>
              void dashboard.updateAllAutoTrackLookAhead(lookAheadDays)
            }
          />
          <WeatherAlgoHistoryIngestSection
            discoverCities={dashboard.discoverGroups().map((g) => g.city)}
          />
        </div>
      </Show>

      <Show when={tab() === 'data'}>
        <WeatherAlgoDataTab />
      </Show>

      <Show when={tab() === 'backtest'}>
        <WeatherAlgoBacktestTab />
      </Show>

      <Show when={tab() === 'strategies'}>
        <WeatherAlgoStrategiesTab />
      </Show>

      <Show when={tab() === 'settings'}>
        <WeatherAlgoSettingsTab />
      </Show>

      <NewSessionResetDialog
        open={resetDialogOpen()}
        onClose={() => setResetDialogOpen(false)}
        mode="manual"
        algoKind="weather"
        onDone={() => {
          void dashboard.loadCapital();
          void dashboard.loadRiskFlags();
          void positions.refresh();
        }}
      />
    </div>
  );
}
