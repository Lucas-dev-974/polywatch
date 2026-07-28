import { createSignal, Show } from 'solid-js';
import { useWeatherAlgoDashboard } from '../hooks/useWeatherAlgoDashboard';
import { useWeatherAlgoPositions } from '../hooks/useWeatherAlgoPositions';
import { WeatherAlgoHeader } from './WeatherAlgoHeader';
import { WeatherAlgoCapitalHero } from './WeatherAlgoCapitalHero';
import { WeatherAlgoDiscoverPanel } from './WeatherAlgoDiscoverPanel';
import { WeatherAlgoActiveMarketsPanel } from './WeatherAlgoActiveMarketsPanel';
import { WeatherAlgoForecastPanel } from './WeatherAlgoForecastPanel';
import { WeatherAlgoPositionsPanel } from './WeatherAlgoPositionsPanel';
import { WeatherAlgoExecutionsPanel } from './WeatherAlgoExecutionsPanel';
import { WeatherAlgoAutoTrackTab } from './WeatherAlgoAutoTrackTab';
import { WeatherAlgoSettingsTab } from './WeatherAlgoSettingsTab';

type Tab = 'markets' | 'positions' | 'autotrack' | 'settings';

export function WeatherAlgoPage() {
  const dashboard = useWeatherAlgoDashboard();
  const positions = useWeatherAlgoPositions();
  const [tab, setTab] = createSignal<Tab>('markets');

  return (
    <div class="weather-algo-page">
      <WeatherAlgoHeader status={dashboard.status()} />
      <WeatherAlgoCapitalHero
        capital={dashboard.capital()}
        realTradingEnabled={dashboard.realTradingEnabled()}
        weatherAlgoSimEnabled={dashboard.weatherAlgoSimEnabled()}
        weatherAlgoRealEnabled={dashboard.weatherAlgoRealEnabled()}
        onToggleRealTrading={dashboard.toggleRealTrading}
      />

      <div class="weather-algo-tabs">
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'markets', 'btn-ghost': tab() !== 'markets' }}
          onClick={() => setTab('markets')}>Marchés</button>
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'positions', 'btn-ghost': tab() !== 'positions' }}
          onClick={() => setTab('positions')}>Positions</button>
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'autotrack', 'btn-ghost': tab() !== 'autotrack' }}
          onClick={() => setTab('autotrack')}>Auto-track</button>
        <button classList={{ 'btn btn-sm': true, 'btn-primary': tab() === 'settings', 'btn-ghost': tab() !== 'settings' }}
          onClick={() => setTab('settings')}>Paramètres</button>
      </div>

      <Show when={tab() === 'markets'}>
        <div class="weather-algo-grid">
          <WeatherAlgoActiveMarketsPanel
            selections={dashboard.selections()}
            onToggle={dashboard.toggleSelection}
            onRemove={dashboard.removeSelection}
          />
          <WeatherAlgoDiscoverPanel
            groups={dashboard.discoverGroups()}
            loading={dashboard.discoverLoading()}
            onRefresh={dashboard.discoverMarkets}
            onAdd={dashboard.addMarket}
          />
          <WeatherAlgoForecastPanel />
        </div>
      </Show>

      <Show when={tab() === 'positions'}>
        <WeatherAlgoPositionsPanel positions={positions} />
        <WeatherAlgoExecutionsPanel />
      </Show>

      <Show when={tab() === 'autotrack'}>
        <WeatherAlgoAutoTrackTab
          rules={dashboard.autoTrackRules()}
          onAdd={dashboard.addAutoTrackRule}
          onRemove={dashboard.removeAutoTrackRule}
          onToggle={dashboard.toggleAutoTrackRule}
        />
      </Show>

      <Show when={tab() === 'settings'}>
        <WeatherAlgoSettingsTab />
      </Show>
    </div>
  );
}