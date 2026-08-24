import { Show } from 'solid-js';

export function UpDownChartMarkerLegend(props: {
  marketStartMs?: number | null;
  marketEndMs?: number | null;
}) {
  return (
    <Show when={props.marketStartMs != null || props.marketEndMs != null}>
      <div class="updown-chart-marker-legend">
        <Show when={props.marketStartMs != null}>
          <span class="updown-chart-marker-legend-item">
            <span class="updown-chart-marker-legend-line" />
            Début fenêtre
          </span>
        </Show>
        <Show when={props.marketEndMs != null}>
          <span class="updown-chart-marker-legend-item">
            <span class="updown-chart-marker-legend-line" />
            Fin fenêtre
          </span>
        </Show>
      </div>
    </Show>
  );
}
