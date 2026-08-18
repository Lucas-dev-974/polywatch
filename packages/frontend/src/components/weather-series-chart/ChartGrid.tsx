import { For } from 'solid-js';
import { formatCents } from '../../lib/format';
import { CHART_H, CHART_MARGIN, Y_TICKS, type ChartScale } from './scale';

/** Grille verticale (temps) + grille horizontale (prix) + axes. */
export function ChartGrid(props: { scale: ChartScale; xTicks: Array<{ t: number; label: string }> }) {
  const { scale } = props;
  return (
    <>
      <For each={props.xTicks}>
        {(tick) => (
          <line
            class="weather-bucket-chart-grid-x"
            x1={scale.xPos(tick.t)}
            y1={CHART_MARGIN.top}
            x2={scale.xPos(tick.t)}
            y2={CHART_MARGIN.top + scale.plotH}
          />
        )}
      </For>
      <For each={Y_TICKS}>
        {(tick) => (
          <g class="weather-bucket-chart-grid-y">
            <line
              x1={CHART_MARGIN.left}
              y1={scale.yPos(tick)}
              x2={CHART_MARGIN.left + scale.plotW}
              y2={scale.yPos(tick)}
            />
            <text
              class="weather-bucket-chart-axis-y"
              x={CHART_MARGIN.left - 8}
              y={scale.yPos(tick)}
              text-anchor="end"
              dominant-baseline="middle"
            >
              {formatCents(tick)}
            </text>
          </g>
        )}
      </For>
      <For each={props.xTicks}>
        {(tick) => (
          <text
            class="weather-bucket-chart-axis-x"
            x={scale.xPos(tick.t)}
            y={CHART_H - 6}
            text-anchor="middle"
          >
            {tick.label}
          </text>
        )}
      </For>
    </>
  );
}
