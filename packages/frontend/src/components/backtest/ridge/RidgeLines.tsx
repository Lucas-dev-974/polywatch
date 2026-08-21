import { createMemo, For, Show } from 'solid-js';
import type { BacktestPositionDto } from '../../../api';
import type { RidgeScale, VisibleVoie } from './types';
import { buildPath, MARGIN_TOP } from './scale';
import { RidgePositionMarkers } from './RidgePositionMarkers';

/** Courbes par bucket, clippées à la zone de plot. */
export function RidgeLines(props: {
  voies: VisibleVoie[];
  scale: RidgeScale;
  hoveredVoieIndex: () => number | null;
  hoveredBucketKey: () => string | null;
  maxTicks?: number | null;
  cutGaps?: boolean;
  clipUntilT?: number | null;
  /** true = points d'entrée/sortie au survol uniquement ; false = en permanence. */
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
                const path = createMemo(() => buildPath(bucket.series, voieTop(), props.scale, props.maxTicks, props.cutGaps, props.clipUntilT));
                const bucketKey = () => `${globalIndex}:${bi()}`;
                const isHovered = () => props.hoveredBucketKey() === bucketKey();
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
