import { For, Show } from 'solid-js';
import type { DiscoverMarket, CityMarketGroup } from '../hooks/useWeatherAlgoDashboard';
import { WeatherCityGroup } from './WeatherCityGroup';

export interface WeatherAlgoDiscoverPanelProps {
  groups: CityMarketGroup[];
  loading: boolean;
  watchedCities: Set<string>;
  onRefresh: () => void;
  onWatchCity: (city: string) => void;
}

export function WeatherAlgoDiscoverPanel(props: WeatherAlgoDiscoverPanelProps) {
  const parisGroup = () => props.groups.find((g) => g.city.toLowerCase() === 'paris');
  const otherGroups = () => props.groups.filter((g) => g.city.toLowerCase() !== 'paris');

  function isWatched(city: string): boolean {
    return props.watchedCities.has(city.trim().toLowerCase());
  }

  function renderGroup(group: CityMarketGroup, defaultExpanded = false) {
    return (
      <WeatherCityGroup
        city={group.city}
        markets={group.markets}
        forecastMean={group.forecastMean}
        forecastStatus={group.forecastStatus}
        defaultExpanded={defaultExpanded}
        renderItem={(market: DiscoverMarket) => (
          <div class="weather-discover-card">
            <div class="weather-discover-card__question">{market.question}</div>
            <div class="weather-discover-card__prices">
              <For each={market.outcomePrices}>
                {(p) => (
                  <span class="weather-discover-card__price">
                    {p.outcome}: {(p.price * 100).toFixed(0)}%
                  </span>
                )}
              </For>
            </div>
          </div>
        )}
        headerExtra={
          <Show
            when={!isWatched(group.city)}
            fallback={<span class="form-hint">Déjà surveillée</span>}
          >
            <button
              type="button"
              class="btn btn-sm btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                props.onWatchCity(group.city);
              }}
            >
              Surveiller cette ville
            </button>
          </Show>
        }
      />
    );
  }

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Découverte marchés Polymarket</h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => props.onRefresh()}
          disabled={props.loading}
        >
          {props.loading ? '...' : 'Rafraîchir'}
        </button>
      </div>
      <p class="form-hint">
        Cliquez sur « Surveiller cette ville » pour suivre la température max. Les paliers
        listés sont informatifs — l’algo choisit le bon bucket automatiquement.
      </p>

      <Show when={props.groups.length === 0 && !props.loading}>
        <div class="algo-empty">Aucun marché météo trouvé sur Polymarket.</div>
      </Show>

      <Show when={parisGroup()}>{(group) => renderGroup(group(), true)}</Show>

      <For each={otherGroups()}>{(group) => renderGroup(group)}</For>
    </section>
  );
}
