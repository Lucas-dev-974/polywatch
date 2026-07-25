import { createSignal, For, Show } from 'solid-js';

export interface WeatherCityGroupProps<T> {
  city: string;
  markets: T[];
  /** Forecast mean temperature in °C. Displayed in the header. */
  forecastMean: number | null;
  /** Forecast status drives styling/tooltip. */
  forecastStatus?: 'fresh' | 'stale' | 'unavailable';
  /** Render each market item inside the accordion body. */
  renderItem: (item: T) => any;
  /** Initial expanded state. Default: collapsed. */
  defaultExpanded?: boolean;
}

export function WeatherCityGroup<T>(props: WeatherCityGroupProps<T>) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

  const forecastLabel = () => {
    if (props.forecastMean == null) return '—';
    return `${props.forecastMean.toFixed(1)}°C`;
  };

  return (
    <div class="weather-city-group" classList={{ 'weather-city-group--expanded': expanded() }}>
      <button
        type="button"
        class="weather-city-group__header"
        onClick={() => setExpanded(!expanded())}
        aria-expanded={expanded()}
      >
        <span class="weather-city-group__chevron">{expanded() ? '▾' : '▸'}</span>
        <span class="weather-city-group__city">{props.city}</span>
        <span
          class="weather-city-group__forecast"
          classList={{
            'weather-city-group__forecast--stale': props.forecastStatus === 'stale',
            'weather-city-group__forecast--unavailable': props.forecastStatus === 'unavailable',
          }}
          title={props.forecastStatus === 'unavailable' ? 'Prévision indisponible' : props.forecastStatus === 'stale' ? 'Prévision expirée' : undefined}
        >
          {forecastLabel()}
        </span>
        <span class="weather-city-group__count">{props.markets.length}</span>
      </button>
      <Show when={expanded()}>
        <div class="weather-city-group__body">
          <For each={props.markets}>
            {(item) => props.renderItem(item)}
          </For>
        </div>
      </Show>
    </div>
  );
}
