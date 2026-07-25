import { For, type JSX } from 'solid-js';

import type { Position } from '../../lib/position';

interface Props {
  positions: () => Position[];
  children: (pos: Position) => JSX.Element;
}

export function PositionListBody(props: Props) {
  return (
    <div class="position-list">
      <For each={props.positions()}>{props.children}</For>
    </div>
  );
}
