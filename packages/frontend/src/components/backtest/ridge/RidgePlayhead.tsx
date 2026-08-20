import { Show } from 'solid-js';
import type { RidgeScale } from './types';
import { MARGIN_TOP } from './scale';

/** Ligne verticale de tête de lecture du player de replay. */
export function RidgePlayhead(props: {
  playheadT: number | null;
  scale: RidgeScale;
  plotH: number;
  viewport: { minT: number; maxT: number };
}) {
  const visible = () => {
    const t = props.playheadT;
    if (t == null) return false;
    if (t < props.viewport.minT || t > props.viewport.maxT) return false;
    return true;
  };

  return (
    <Show when={visible()}>
      <line
        x1={props.scale.xPos(props.playheadT!)}
        y1={MARGIN_TOP}
        x2={props.scale.xPos(props.playheadT!)}
        y2={MARGIN_TOP + props.plotH}
        class="ridge-playhead"
      />
    </Show>
  );
}
