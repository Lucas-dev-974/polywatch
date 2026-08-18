import { For, Show } from 'solid-js';
import { CHART_MARGIN } from './scale';
import type { ChartScale } from './scale';
import type { SeriesChartMarker } from './types';

/** Markers de position (entrée/sortie) superposés sur le graph. */
export function PositionMarkers(props: {
  markers: SeriesChartMarker[];
  scale: ChartScale;
}) {
  return (
    <For each={props.markers}>
      {(marker) => {
        const inRange = () =>
          marker.t >= props.scale.minT &&
          marker.t <= props.scale.maxT &&
          marker.y >= 0 &&
          marker.y <= 1;
        const mx = () => props.scale.xPos(marker.t);
        const my = () => props.scale.yPos(marker.y);
        return (
          <Show when={inRange()}>
            <g class={`weather-bucket-marker weather-bucket-marker--${marker.kind}`}>
              <line
                x1={mx()}
                y1={CHART_MARGIN.top}
                x2={mx()}
                y2={CHART_MARGIN.top + props.scale.plotH}
                class="weather-bucket-marker__guide"
              />
              <circle class="weather-bucket-marker__dot" cx={mx()} cy={my()} r="4.5" />
            </g>
          </Show>
        );
      }}
    </For>
  );
}
