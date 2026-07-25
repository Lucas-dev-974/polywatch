import { For, Show } from 'solid-js';
import { parseWeatherQuestion } from '@polywatch/core/weather/question-parser';
import type { DiscoverMarket, CityMarketGroup } from '../hooks/useWeatherAlgoDashboard';
import { WeatherCityGroup } from './WeatherCityGroup';

export interface WeatherAlgoDiscoverPanelProps {
  groups: CityMarketGroup[];
  loading: boolean;
  onRefresh: () => void;
  onAdd: (conditionId: string, question: string, eventSlug: string | null) => void;
}

export function WeatherAlgoDiscoverPanel(props: WeatherAlgoDiscoverPanelProps) {
  const parisGroup = () => props.groups.find((g) => g.city.toLowerCase() === 'paris');
  const otherGroups = () => props.groups.filter((g) => g.city.toLowerCase() !== 'paris');

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

      <Show when={props.groups.length === 0 && !props.loading}>
        <div class="algo-empty">Aucun marché météo trouvé sur Polymarket.</div>
      </Show>

      <Show when={parisGroup()}>
        {(group) => (
          <WeatherCityGroup
            city={group().city}
            markets={group().markets}
            forecastMean={group().forecastMean}
            forecastStatus={group().forecastStatus}
            defaultExpanded={true}
            renderItem={(market: DiscoverMarket) => {
              const parsed = market.question ? parseWeatherQuestion(market.question) : null;
              return (
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
                  <Show when={parsed}>
                    <button
                      class="btn btn-sm btn-primary"
                      onClick={() => props.onAdd(market.conditionId, market.question ?? '', market.eventSlug)}
                    >
                      + Suivre
                    </button>
                  </Show>
                  <Show when={!parsed}>
                    <button
                      class="btn btn-sm btn-ghost"
                      onClick={() => props.onAdd(market.conditionId, market.question ?? '', market.eventSlug)}
                    >
                      + Suivre manuellement
                    </button>
                  </Show>
                </div>
              );
            }}
          />
        )}
      </Show>

      <For each={otherGroups()}>
        {(group) => (
          <WeatherCityGroup
            city={group.city}
            markets={group.markets}
            forecastMean={group.forecastMean}
            forecastStatus={group.forecastStatus}
            renderItem={(market: DiscoverMarket) => {
              const parsed = market.question ? parseWeatherQuestion(market.question) : null;
              return (
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
                  <Show when={parsed}>
                    <button
                      class="btn btn-sm btn-primary"
                      onClick={() => props.onAdd(market.conditionId, market.question ?? '', market.eventSlug)}
                    >
                      + Suivre
                    </button>
                  </Show>
                  <Show when={!parsed}>
                    <button
                      class="btn btn-sm btn-ghost"
                      onClick={() => props.onAdd(market.conditionId, market.question ?? '', market.eventSlug)}
                    >
                      + Suivre manuellement
                    </button>
                  </Show>
                </div>
              );
            }}
          />
        )}
      </For>
    </section>
  );
}
