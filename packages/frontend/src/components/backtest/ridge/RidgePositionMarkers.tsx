import { createMemo, For } from 'solid-js';
import type { BacktestPositionDto } from '../../../api';
import type { RidgeScale, VoieGroup } from './types';

interface Marker {
  x: number;
  y: number;
  kind: 'entry' | 'exit';
  position: BacktestPositionDto;
}

interface ParsedPosition {
  position: BacktestPositionDto;
  entryT: number;
  exitT: number | null;
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
  // Pré-parser les timestamps des positions une seule fois (stable pendant le run).
  const parsedPositions = createMemo<ParsedPosition[]>(() => {
    const out: ParsedPosition[] = [];
    for (const bucket of props.voie.positionBuckets) {
      const pos = bucket.position;
      if (!pos) continue;
      out.push({
        position: pos,
        entryT: Date.parse(pos.entryAt),
        exitT: pos.exitAt ? Date.parse(pos.exitAt) : null,
      });
    }
    return out;
  });

  const markers = createMemo<Marker[]>(() => {
    const out: Marker[] = [];
    for (const parsed of parsedPositions()) {
      if (!Number.isNaN(parsed.entryT)) {
        out.push({
          x: props.scale.xPos(parsed.entryT),
          y: props.scale.yPos(parsed.position.entryPrice, props.voieTop),
          kind: 'entry',
          position: parsed.position,
        });
      }
      if (parsed.exitT != null && !Number.isNaN(parsed.exitT)) {
        out.push({
          x: props.scale.xPos(parsed.exitT),
          y: props.scale.yPos(parsed.position.exitPrice ?? parsed.position.entryPrice, props.voieTop),
          kind: 'exit',
          position: parsed.position,
        });
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
