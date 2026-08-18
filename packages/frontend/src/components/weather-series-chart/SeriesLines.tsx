import { For } from 'solid-js';
import type { SegmentedBucket } from './types';
import { seriesColor } from './palette';
import type { ChartScale } from './scale';

/** Trace les lignes de chaque segment de chaque bucket visible. */
export function SeriesLines(props: { buckets: SegmentedBucket[]; scale: ChartScale }) {
  return (
    <For each={props.buckets}>
      {(s, i) => (
        <For each={s.segments}>
          {(seg) => (
            <path
              d={seg
                .map(
                  (p, idx) =>
                    `${idx === 0 ? 'M' : 'L'}${props.scale.xPos(p.t).toFixed(1)},${props.scale.yPos(p.y).toFixed(1)}`,
                )
                .join(' ')}
              fill="none"
              stroke={seriesColor(i())}
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          )}
        </For>
      )}
    </For>
  );
}
