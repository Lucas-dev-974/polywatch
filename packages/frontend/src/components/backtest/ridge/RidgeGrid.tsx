import { For } from 'solid-js';
import type { RidgeScale, VoieGroup } from './types';
import { MARGIN_TOP, VOIE_H, Y_TICKS } from './scale';

/** Grille temporelle (verticale) + grille prix par row (horizontale). */
export function RidgeGrid(props: {
  voies: VoieGroup[];
  xTicks: Array<{ t: number; label: string }>;
  scale: RidgeScale;
}) {
  return (
    <>
      <For each={props.xTicks}>
        {(tick) => (
          <line
            x1={props.scale.xPos(tick.t)}
            y1={MARGIN_TOP}
            x2={props.scale.xPos(tick.t)}
            y2={MARGIN_TOP + props.voies.length * VOIE_H}
            class="backtest-ridge-grid-line"
          />
        )}
      </For>
      <For each={props.voies}>
        {(_, i) => {
          const voieTop = props.scale.top(i());
          return (
            <g>
              <For each={Y_TICKS}>
                {(yt) => (
                  <line
                    x1={0}
                    y1={props.scale.yPos(yt, voieTop)}
                    x2={props.scale.plotW}
                    y2={props.scale.yPos(yt, voieTop)}
                    class="backtest-ridge-grid-line"
                  />
                )}
              </For>
            </g>
          );
        }}
      </For>
    </>
  );
}
