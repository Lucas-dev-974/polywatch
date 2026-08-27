import { createSignal, For, Show } from 'solid-js';
import type { WeatherPosition } from '../../hooks/useWeatherAlgoPositions';
import { WeatherPositionMarketChartDialog } from '../dialogs/WeatherPositionMarketChartDialog';
import { WeatherPositionCityCard } from './WeatherPositionCityCard';
import type { WeatherPositionCityGroup } from './types';

interface WeatherPositionGroupedListProps {
  groups: WeatherPositionCityGroup[];
  onClose?: (id: number) => void;
}

export function WeatherPositionGroupedList(props: WeatherPositionGroupedListProps) {
  const [chartPosition, setChartPosition] = createSignal<WeatherPosition | null>(null);
  return (
    <div class="weather-history-grid">
      <For each={props.groups}>
        {(group) => (
          <WeatherPositionCityCard
            group={group}
            onOpenChart={setChartPosition}
            onClose={props.onClose}
          />
        )}
      </For>
      <Show when={chartPosition()}>
        {(p) => (
          <WeatherPositionMarketChartDialog
            position={p()}
            onClose={() => setChartPosition(null)}
          />
        )}
      </Show>
    </div>
  );
}
