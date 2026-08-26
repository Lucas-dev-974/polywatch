import { createMemo, For, Show } from 'solid-js';
import type { BacktestPositionDto } from '../../../api';
import type { RidgeScale, VisibleVoie } from './types';
import { buildPathFromProjected, computeGapThreshold, projectSeries } from './projection';
import { RidgePositionMarkers } from './RidgePositionMarkers';
import { MARGIN_TOP } from './scale';

/** Courbes par bucket, clippées à la zone de plot. */
export function RidgeLines(props: {
  voies: VisibleVoie[];
  scale: RidgeScale;
  hoveredVoieIndex: () => number | null;
  hoveredBucketKey: () => string | null;
  maxTicks?: number | null;
  cutGaps?: boolean;
  showEntryExit?: boolean;
  onPositionHover: (pos: BacktestPositionDto | null, x: number, y: number) => void;
}) {
  return (
    <For each={props.voies}>
      {(visible) => {
        const voie = visible.voie;
        const globalIndex = visible.globalIndex;
        const voieTop = createMemo(() => props.scale.top(globalIndex));
        return (
          <g>
            <For each={voie.buckets}>
              {(bucket, bi) => {
                const bucketKey = () => `${globalIndex}:${bi()}`;
                const isHovered = () => props.hoveredBucketKey() === bucketKey();

                // Géométrie stable (EnrichedSeries) — ne change que si les données changent
                const geometry = createMemo(() => bucket.enriched);
                
                // Projection : dépend des bornes viewport (minT/maxT/plotW) PAS de l'objet scale entier
                const projected = createMemo(() => {
                  const geom = geometry();
                  if (!geom) return [];
                  return projectSeries(geom, props.scale, voieTop());
                });
                
                // Path string : dépend de projected + gapThreshold.
                // Quand cutGaps est décoché, on désactive la segmentation (seuil
                // Infinity) pour relier les trous : tracé continu.
                const path = createMemo(() => {
                  const proj = projected();
                  if (proj.length === 0) return '';
                  const gapThreshold = props.cutGaps === false ? Infinity : computeGapThreshold(proj);
                  return buildPathFromProjected(proj, gapThreshold);
                });

                return (
                  <g>
                    <Show when={path()}>
                      <path
                        d={path()}
                        fill="none"
                        stroke={bucket.color}
                        stroke-width={isHovered() ? '2.5' : '1.5'}
                        class={isHovered() ? 'backtest-ridge-line backtest-ridge-line-focused' : 'backtest-ridge-line'}
                      />
                    </Show>
                  </g>
                );
              }}
            </For>
            <Show when={props.showEntryExit === false || props.hoveredVoieIndex() === globalIndex}>
              <RidgePositionMarkers voie={voie} scale={props.scale} voieTop={voieTop()} onHover={props.onPositionHover} />
            </Show>
          </g>
        );
      }}
    </For>
  );
}

/** Ligne verticale du crosshair au survol. */
export function RidgeCrosshair(props: {
  hoveredT: number | null;
  plotH: number;
  scale: RidgeScale;
}) {
  return (
    <Show when={props.hoveredT != null}>
      <line
        x1={props.scale.xPos(props.hoveredT!)}
        y1={MARGIN_TOP}
        x2={props.scale.xPos(props.hoveredT!)}
        y2={MARGIN_TOP + props.plotH}
        class="backtest-ridge-crosshair"
      />
    </Show>
  );
}
