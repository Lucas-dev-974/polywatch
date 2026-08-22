import { createMemo, For } from 'solid-js';
import type { BacktestPositionDto } from '../../../api';
import type { RidgeScale, VoieGroup } from './types';

interface Marker {
  x: number;
  y: number;
  kind: 'entry' | 'exit';
  position: BacktestPositionDto;
}

/**
 * Points de position affichés au survol d'une row. Un cercle vert marque
 * l'entrée d'une position, un cercle rouge sa sortie. Remplace les barres
 * verticales précédentes pour rester cohérent avec les markers du player.
 */
export function RidgePositionMarkers(props: {
  voie: VoieGroup;
  scale: RidgeScale;
  voieTop: number;
  onHover: (pos: BacktestPositionDto | null, x: number, y: number) => void;
}) {
  const markers = createMemo<Marker[]>(() => {
    const out: Marker[] = [];
    for (const bucket of props.voie.positionBuckets) {
      const pos = bucket.position;
      if (!pos) continue;
      const entryT = Date.parse(pos.entryAt);
      if (!Number.isNaN(entryT)) {
        out.push({
          x: props.scale.xPos(entryT),
          y: props.scale.yPos(pos.entryPrice, props.voieTop),
          kind: 'entry',
          position: pos,
        });
      }
      if (pos.exitAt) {
        const exitT = Date.parse(pos.exitAt);
        if (!Number.isNaN(exitT)) {
          out.push({
            x: props.scale.xPos(exitT),
            y: props.scale.yPos(pos.exitPrice ?? pos.entryPrice, props.voieTop),
            kind: 'exit',
            position: pos,
          });
        }
      }
    }
    return out;
  });

  return (
    <For each={markers()}>
      {(m) => {
        const winExit = m.kind === 'exit' && m.position.pnl != null && m.position.pnl >= 0;
        return (
          <g>
            {winExit && (
              <circle
                cx={m.x}
                cy={m.y}
                r={5}
                class="ridge-position-marker-ring-win"
              />
            )}
            <circle
              cx={m.x}
              cy={m.y}
              r={4}
              class={`ridge-position-marker ${m.kind === 'entry' ? 'ridge-position-marker-entry' : 'ridge-position-marker-exit'}`}
              onPointerEnter={() => props.onHover(m.position, m.x, m.y)}
              onPointerLeave={() => props.onHover(null, 0, 0)}
            />
          </g>
        );
      }}
    </For>
  );
}
