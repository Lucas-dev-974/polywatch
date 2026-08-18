import { Show } from 'solid-js';
import { CHART_MARGIN } from './scale';
import type { ChartScale } from './scale';
import type { HoverState } from './types';

/** Ligne verticale du crosshair au survol. */
export function Crosshair(props: { hovered: HoverState | null; scale: ChartScale }) {
  return (
    <Show when={props.hovered}>
      <line
        class="weather-bucket-crosshair"
        x1={props.hovered!.svgX}
        y1={CHART_MARGIN.top}
        x2={props.hovered!.svgX}
        y2={CHART_MARGIN.top + props.scale.plotH}
      />
    </Show>
  );
}
