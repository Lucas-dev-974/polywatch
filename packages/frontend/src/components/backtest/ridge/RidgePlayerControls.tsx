import { For, Show } from 'solid-js';
import { formatTs } from '../format';

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

interface RidgePlayerControlsProps {
  isPlaying: boolean;
  currentIndex: number;
  total: number;
  playheadT: number | null;
  speed: number;
  onToggle: () => void;
  onSeekIndex: (i: number) => void;
  onSpeed: (s: number) => void;
  onReset: () => void;
}

/** Barre de contrôles du player de replay (play/pause, seek, index, vitesse). */
export function RidgePlayerControls(props: RidgePlayerControlsProps) {
  return (
    <Show when={props.total > 0}>
      <div class="ridge-player-controls">
        <button
          type="button"
          class="btn btn-sm btn-ghost ridge-player-btn"
          onClick={props.onToggle}
          title={props.isPlaying ? 'Pause' : 'Lecture'}
        >
          {props.isPlaying ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost ridge-player-btn"
          onClick={props.onReset}
          title="Rejouer depuis le début"
        >
          ⏮
        </button>
        <input
          type="range"
          class="ridge-player-slider"
          min={0}
          max={Math.max(0, props.total - 1)}
          value={props.currentIndex}
          onInput={(e) => props.onSeekIndex(Number(e.currentTarget.value))}
        />
        <span class="ridge-player-index">
          {props.currentIndex} / {props.total}
        </span>
        <Show when={props.playheadT != null}>
          <span class="ridge-player-time">{formatTs(new Date(props.playheadT!).toISOString())}</span>
        </Show>
        <select
          class="ridge-player-speed"
          value={props.speed}
          onChange={(e) => props.onSpeed(Number(e.currentTarget.value))}
        >
          <For each={SPEED_OPTIONS}>
            {(s) => <option value={s}>{s}x</option>}
          </For>
        </select>
      </div>
    </Show>
  );
}
