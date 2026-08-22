import { For, Show } from 'solid-js';
import type { RidgeScale, VisibleVoie } from './types';
import { MARGIN_TOP, VOIE_H } from './scale';

const PAD_L = 8;
const Y_AXIS_W = 148;
const X_AXIS_H = 40;

/** Axe Y : labels des rows (ville · date · prévision) par voie visible, virtualisé. */
export function RidgeAxisY(props: {
  visibleVoies: VisibleVoie[];
  scale: RidgeScale;
  heightPlot: number;
  hoveredVoieIndex: number | null;
}) {
  return (
    <svg
      viewBox={`0 0 ${Y_AXIS_W} ${props.heightPlot}`}
      width={Y_AXIS_W}
      height={props.heightPlot}
      role="img"
      aria-label="Axe Y : marchés par date cible et prévision"
    >
      <For each={props.visibleVoies}>
        {(visible) => {
          const voie = visible.voie;
          const cy = props.scale.top(visible.globalIndex) + VOIE_H / 2;
          const hasForecast = voie.forecastMean != null;
          const forecastLabel = hasForecast
            ? `FC ${voie.forecastMean!.toFixed(1)}${voie.forecastStdDev != null ? ` ± ${voie.forecastStdDev.toFixed(1)}` : ''}`
            : null;
          return (
            <>
              <text
                x={PAD_L}
                y={hasForecast ? cy - 2 : cy + 4}
                class={props.hoveredVoieIndex === visible.globalIndex ? 'backtest-ridge-label backtest-ridge-label-focused' : 'backtest-ridge-label'}
                text-anchor="start"
              >
                {voie.city ?? '—'} · {voie.date}
              </text>
              <Show when={forecastLabel != null}>
                <text
                  x={PAD_L}
                  y={cy + 8}
                  class="backtest-ridge-label-forecast"
                  text-anchor="start"
                >
                  {forecastLabel}
                </text>
              </Show>
            </>
          );
        }}
      </For>
      <text
        x={10}
        y={props.heightPlot / 2}
        text-anchor="middle"
        transform={`rotate(-90 10 ${props.heightPlot / 2})`}
        class="backtest-ridge-axis-title"
      >
        Prix YES
      </text>
    </svg>
  );
}

/** Axe X : ticks temporels + indicateur "fin des données". */
export function RidgeAxisX(props: {
  scale: RidgeScale;
  plotW: number;
  xTicks: Array<{ t: number; label: string }>;
  nowX: number | null;
}) {
  return (
    <svg
      viewBox={`0 0 ${props.plotW} ${X_AXIS_H}`}
      width="100%"
      height={X_AXIS_H}
      role="img"
      aria-label="Axe X : temps"
    >
      <For each={props.xTicks}>
        {(tick) => (
          <text x={props.scale.xPos(tick.t)} y={14} text-anchor="middle" class="backtest-ridge-axis-label">
            {tick.label}
          </text>
        )}
      </For>
      <Show when={props.nowX != null}>
        <line
          x1={props.nowX!}
          y1={0}
          x2={props.nowX!}
          y2={X_AXIS_H}
          class="backtest-ridge-now"
        />
        <text
          x={props.nowX!}
          y={X_AXIS_H - 6}
          text-anchor="middle"
          class="backtest-ridge-now-label"
        >
          fin des données
        </text>
      </Show>
      <text
        x={props.plotW / 2}
        y={32}
        text-anchor="middle"
        class="backtest-ridge-axis-title"
      >
        Temps
      </text>
    </svg>
  );
}
