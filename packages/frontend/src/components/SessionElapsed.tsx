import { Show } from 'solid-js';
import { useClock } from '../hooks/useClock';
import { elapsedMsSince } from '../lib/session-elapsed';
import { formatSessionDuration } from '../lib/simulation-sessions';

interface Props {
  startedAt: string;
  endedAt?: string | null;
  /** When true and no endedAt, ticks every second. */
  live?: boolean;
  class?: string;
  showLiveBadge?: boolean;
}

export function SessionElapsed(props: Props) {
  const isLive = () => props.live !== false && !props.endedAt;
  const now = useClock(isLive() ? 1_000 : 60_000);
  const durationMs = () =>
    elapsedMsSince(props.startedAt, props.endedAt ?? null, now());

  return (
    <span class={props.class ?? 'session-elapsed mono'}>
      {formatSessionDuration(durationMs())}
      <Show when={isLive() && props.showLiveBadge !== false}>
        <span class="session-elapsed-live" title="Mise à jour en direct">
          {' '}
          · live
        </span>
      </Show>
    </span>
  );
}
