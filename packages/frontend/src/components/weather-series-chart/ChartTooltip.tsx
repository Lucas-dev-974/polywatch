import { For, Show } from 'solid-js';
import { formatCents } from '../../lib/format';
import { CHART_MARGIN } from './scale';
import { formatChartTooltipDateTime } from './format';
import type { HoverState, TooltipRow } from './types';

/** Tooltip crosshair affiché au survol. */
export function ChartTooltip(props: {
  hovered: HoverState | null;
  rows: TooltipRow[];
  spanMs: number;
}) {
  return (
    <Show when={props.hovered && props.rows.length > 0}>
      <div
        class="weather-bucket-tooltip"
        style={{
          left: `${props.hovered!.svgX}px`,
          top: `${CHART_MARGIN.top}px`,
        }}
      >
        <strong>{formatChartTooltipDateTime(props.hovered!.t, props.spanMs)}</strong>
        <For each={props.rows}>
          {(b) => (
            <div class="weather-bucket-tooltip-row">
              <span class="weather-bucket-legend-swatch" style={{ background: b.color }} />
              <span class="weather-bucket-tooltip-label">{b.label}</span>
              <span class="weather-bucket-tooltip-price">{formatCents(b.price)}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
