import { For, Show } from 'solid-js';
import { formatShortDateTime } from '../../lib/date';
import type { SeriesChartMarker } from './types';

/** Légende des markers de position (entrée/sortie) sous le graph. */
export function MarkerLegend(props: { markers: SeriesChartMarker[] }) {
  return (
    <Show when={props.markers.length > 0}>
      <div class="weather-bucket-marker-legend">
        <For each={props.markers}>
          {(m) => (
            <span class="weather-bucket-marker-legend-item">
              <span
                class={`weather-bucket-marker-legend-swatch weather-bucket-marker-legend-swatch--${m.kind}`}
              />
              {m.label} {m.y.toFixed(3)} · {formatShortDateTime(new Date(m.t).toISOString())}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}
