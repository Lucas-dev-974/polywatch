import { For } from 'solid-js';
import type { RidgeScale, VisibleVoie } from './types';
import { MARGIN_TOP, VOIE_H, yTicksForVoieH } from './scale';

/** Grille temporelle (verticale) + grille prix par row (horizontale). */
export function RidgeGrid(props: {
  voies: VisibleVoie[];
  xTicks: Array<{ t: number; label: string }>;
  scale: RidgeScale;
  /** Hauteur totale du plot (toutes les voies), pour les lignes verticales. */
  plotH: number;
}) {
  // Résultat constant par VOIE_H — calculé une seule fois, pas dans le For (P7).
  const yTicks = yTicksForVoieH(VOIE_H);
  return (
    <>
      <For each={props.xTicks}>
        {(tick) => (
          <line
            x1={props.scale.xPos(tick.t)}
            y1={MARGIN_TOP}
            x2={props.scale.xPos(tick.t)}
            y2={MARGIN_TOP + props.plotH}
            class="backtest-ridge-grid-line"
          />
        )}
      </For>
      <For each={props.voies}>
        {(visible) => {
          const voieTop = props.scale.top(visible.globalIndex);
          return (
            <g>
              <For each={yTicks}>
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
