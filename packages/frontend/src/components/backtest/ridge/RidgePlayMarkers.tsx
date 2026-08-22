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

  const markers = createMemo<Marker[]>(() => {
    const t = props.playheadT;
    if (t == null) return [];
    const map = voieIndexByCondition();
    const out: Marker[] = [];
    for (const pos of props.positions) {
      const voieIndex = map.get(pos.conditionId);
      if (voieIndex == null) continue;
      const entryT = Date.parse(pos.entryAt);
      if (Number.isNaN(entryT) || t < entryT) continue;
      const voieTop = props.scale.top(voieIndex);
      out.push({
        x: props.scale.xPos(entryT),
        y: props.scale.yPos(pos.entryPrice, voieTop),
        kind: 'entry',
        position: pos,
      });
      if (pos.exitAt) {
        const exitT = Date.parse(pos.exitAt);
        if (!Number.isNaN(exitT) && t >= exitT) {
          out.push({
            x: props.scale.xPos(exitT),
            y: props.scale.yPos(pos.exitPrice ?? pos.entryPrice, voieTop),
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
