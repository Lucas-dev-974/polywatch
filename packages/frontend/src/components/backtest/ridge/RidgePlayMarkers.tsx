import { createMemo, For } from 'solid-js';
import type { BacktestPositionDto } from '../../../api';
import type { RidgeScale, VoieGroup } from './types';

interface RidgePlayMarkersProps {
  positions: BacktestPositionDto[];
  scale: RidgeScale;
  voies: VoieGroup[];
  playheadT: number | null;
  onHover: (pos: BacktestPositionDto | null) => void;
}

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
 * Markers de position du player de replay. Un cercle vert apparaît quand le
 * playhead atteint l'entryAt d'une position, un cercle rouge à l'exitAt.
 * Utilise toutes les props.positions (pas voie.positionBuckets qui ne garde
 * que la première position par conditionId).
 */
export function RidgePlayMarkers(props: RidgePlayMarkersProps) {
  // Map conditionId -> index de voie (P4).
  const voieIndexByCondition = createMemo(() => {
    const map = new Map<string, number>();
    props.voies.forEach((voie, i) => {
      for (const b of voie.buckets) {
        if (!map.has(b.series.conditionId)) map.set(b.series.conditionId, i);
      }
    });
    return map;
  });

  // Pré-parser les timestamps des positions une seule fois (stable pendant le run).
  const parsedPositions = createMemo<ParsedPosition[]>(() => {
    return props.positions.map((pos) => ({
      position: pos,
      entryT: Date.parse(pos.entryAt),
      exitT: pos.exitAt ? Date.parse(pos.exitAt) : null,
    }));
  });

  const markers = createMemo<Marker[]>(() => {
    const t = props.playheadT;
    if (t == null) return [];
    const map = voieIndexByCondition();
    const out: Marker[] = [];
    for (const parsed of parsedPositions()) {
      const voieIndex = map.get(parsed.position.conditionId);
      if (voieIndex == null) continue;
      if (Number.isNaN(parsed.entryT) || t < parsed.entryT) continue;
      const voieTop = props.scale.top(voieIndex);
      out.push({
        x: props.scale.xPos(parsed.entryT),
        y: props.scale.yPos(parsed.position.entryPrice, voieTop),
        kind: 'entry',
        position: parsed.position,
      });
      if (parsed.exitT != null && !Number.isNaN(parsed.exitT) && t >= parsed.exitT) {
        out.push({
          x: props.scale.xPos(parsed.exitT),
          y: props.scale.yPos(parsed.position.exitPrice ?? parsed.position.entryPrice, voieTop),
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
                class="ridge-play-marker-ring-win"
              />
            )}
            <circle
              cx={m.x}
              cy={m.y}
              r={4}
              class={`ridge-play-marker ${m.kind === 'entry' ? 'ridge-play-marker-entry' : 'ridge-play-marker-exit'}`}
              onPointerEnter={() => props.onHover(m.position)}
              onPointerLeave={() => props.onHover(null)}
            />
          </g>
        );
      }}
    </For>
  );
}
