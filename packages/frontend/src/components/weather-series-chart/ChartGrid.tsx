import { For } from 'solid-js';
import { formatCents } from '../../lib/format';
import { CHART_H, CHART_MARGIN, Y_TICKS, type ChartScale } from './scale';

/** Grille verticale (temps) + grille horizontale (prix) + axes. */
export function ChartGrid(props: { scale: ChartScale; xTicks: Array<{ t: number; label: string }> }) {
  // NE PAS déstructurer `props.scale` : en Solid, `const { scale } = props`
  // capture la valeur au mount et perd la réactivité. Quand les données
  // asynchrones arrivent (dialog Positions), `props.scale` change mais la
  // variable locale reste figée → ticks/lignes écrasés à gauche. On lit
  // toujours `props.scale.*` dans le JSX pour rester réactif.
  return (
    <>
      <For each={props.xTicks}>
        {(tick) => (
          <line
            class="weather-bucket-chart-grid-x"
            x1={props.scale.xPos(tick.t)}
            y1={CHART_MARGIN.top}
            x2={props.scale.xPos(tick.t)}
            y2={CHART_MARGIN.top + props.scale.plotH}
          />
        )}
      </For>
      <For each={Y_TICKS}>
        {(tick) => (
          <g class="weather-bucket-chart-grid-y">
            <line
              x1={CHART_MARGIN.left}
              y1={props.scale.yPos(tick)}
              x2={CHART_MARGIN.left + props.scale.plotW}
              y2={props.scale.yPos(tick)}
            />
            <text
              class="weather-bucket-chart-axis-y"
              x={CHART_MARGIN.left - 8}
              y={props.scale.yPos(tick)}
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
            x={props.scale.xPos(tick.t)}
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
