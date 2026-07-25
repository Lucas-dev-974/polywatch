import { For } from 'solid-js';

import { INTERVAL_FILTER_OPTIONS } from '../lib/markets-list';

interface Props {
  activeInterval: () => string | null;
  onSelectInterval: (interval: string | null) => void;
}

export function MarketsIntervalSidebar(props: Props) {
  return (
    <aside class="markets-interval-sidebar">
      <For each={INTERVAL_FILTER_OPTIONS}>
        {(interval) => (
          <button
            type="button"
            class={`markets-interval-chip${props.activeInterval() === interval.value ? ' active' : ''}`}
            onClick={() =>
              props.onSelectInterval(
                props.activeInterval() === interval.value ? null : interval.value,
              )
            }
          >
            {interval.label}
          </button>
        )}
      </For>
    </aside>
  );
}
