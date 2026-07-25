import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';

import { getTimeRemaining } from '../../lib/markets-list';

interface Props {
  endDate: string | null;
}

export function PositionCountdown(props: Props) {
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });

  const remaining = createMemo(() => {
    const r = getTimeRemaining(props.endDate, now());
    if (!r || r.expired) return null;
    return r;
  });

  const formatted = createMemo(() => {
    const r = remaining();
    if (!r) return null;
    const h = Math.floor(r.minutes / 60);
    const m = r.minutes % 60;
    const s = r.seconds;
    if (h > 0) {
      return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  });

  return (
    <Show when={formatted()}>
      {(data) => <span class="position-countdown">{data()}</span>}
    </Show>
  );
}
