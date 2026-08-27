import { createEffect, createSignal, onCleanup, Show, type Accessor } from 'solid-js';
import type { E2eRunDto, E2eSuiteDto } from '../../lib/e2e-runs';
import {
  e2eStatusLabel,
  e2eSummaryText,
  e2eSuiteLabel,
  formatE2eRunDuration,
} from '../../lib/e2e-runs';

/** Horloge qui ne tick que pendant un run actif (1 Hz). */
export function useE2eLiveClock(isRunning: Accessor<boolean>): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    if (!isRunning()) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    onCleanup(() => clearInterval(id));
  });

  return now;
}

export interface E2eRunStatusBarProps {
  run: E2eRunDto;
  suites: E2eSuiteDto[];
  nowMs: number;
  stopping?: boolean;
  onStop?: () => void;
}

export function E2eRunStatusBar(props: E2eRunStatusBarProps) {
  const isRunning = () => props.run.status === 'running';
  const durationLabel = () =>
    isRunning() ? 'En cours depuis' : 'Durée totale';

  return (
    <div
      class="e2e-status-bar"
      classList={{ 'e2e-status-bar--running': isRunning() }}
      role="status"
      aria-live="polite"
    >
      <div class="e2e-status-bar-main">
        <Show when={isRunning()}>
          <span class="e2e-status-bar-pulse" aria-hidden="true" />
        </Show>
        <span class={`badge e2e-status-badge e2e-status-${props.run.status}`}>
          {e2eStatusLabel(props.run.status)}
        </span>
        <span class="e2e-status-bar-suite">{e2eSuiteLabel(props.suites, props.run.suite)}</span>
      </div>

      <div class="e2e-status-bar-timer">
        <span class="e2e-status-bar-timer-label text-muted">{durationLabel()}</span>
        <span class="e2e-status-bar-timer-value">
          {formatE2eRunDuration(props.run, props.nowMs)}
        </span>
      </div>

      <div class="e2e-status-bar-meta">
        <Show when={props.run.summary}>
          {(s) => <span class="text-muted">{e2eSummaryText(s())}</span>}
        </Show>
        <Show when={props.run.errorMessage}>
          {(msg) => <span class="e2e-error">{msg()}</span>}
        </Show>
      </div>

      <Show when={isRunning() && props.onStop}>
        <button
          type="button"
          class="btn btn-sm btn-danger e2e-status-bar-stop"
          disabled={props.stopping}
          onClick={() => props.onStop?.()}
        >
          {props.stopping ? 'Arrêt…' : 'Stopper le test'}
        </button>
      </Show>
    </div>
  );
}
