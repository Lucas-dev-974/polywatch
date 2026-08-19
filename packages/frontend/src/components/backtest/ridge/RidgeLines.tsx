import { createMemo, For, Show } from 'solid-js';
import type { RidgeScale, VoieGroup } from './types';
import { buildPath, MARGIN_TOP, VOIE_H } from './scale';

/** Courbes par bucket, clippées à la zone de plot. */
export function RidgeLines(props: {
  voies: VoieGroup[];
  scale: RidgeScale;
  hoveredVoieIndex: () => number | null;
  hoveredBucketKey: () => string | null;
  maxTicks?: number | null;
  cutGaps?: boolean;
}) {
  return (
    <For each={props.voies}>
      {(voie, i) => {
        const voieTop = createMemo(() => props.scale.top(i()));
        return (
          <g>
            <For each={voie.buckets}>
              {(bucket, bi) => {
                const path = createMemo(() => buildPath(bucket.series, voieTop(), props.scale, props.maxTicks, props.cutGaps));
                const bucketKey = () => `${i()}:${bi()}`;
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
            <Show when={props.hoveredVoieIndex() === i()}>
              <For each={voie.positionBuckets}>
                {(bucket) => {
                  const pos = bucket.position!;
                  const entryX = createMemo(() => props.scale.xPos(Date.parse(pos.entryAt)));
                  const exitX = createMemo(() => pos.exitAt ? props.scale.xPos(Date.parse(pos.exitAt)) : null);
                  return (
                    <g>
                      <line x1={entryX()} y1={voieTop() + 4} x2={entryX()} y2={voieTop() + VOIE_H - 4} class="backtest-ridge-marker-entry" />
                      <Show when={exitX() != null}>
                        <line x1={exitX()!} y1={voieTop() + 4} x2={exitX()!} y2={voieTop() + VOIE_H - 4} class="backtest-ridge-marker-exit" />
                      </Show>
                    </g>
                  );
                }}
              </For>
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
