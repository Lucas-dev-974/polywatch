import { For } from 'solid-js';
import { TIMEFRAMES } from '../lib/market-chart';

interface TimeframeOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (tf: string) => void;
  /** Options affichées (défaut : périodes lookback). */
  options?: readonly TimeframeOption[];
  /** Libellé à gauche des chips (défaut : « Période : »). */
  label?: string;
}

export function TimeframeSelector(props: Props) {
  const options = () => props.options ?? TIMEFRAMES;
  const label = () => props.label ?? 'Période :';

  return (
    <div class="timeframe-selector">
      <span class="timeframe-selector-label">{label()}</span>
      <For each={options()}>
        {(tf) => (
          <button
            type="button"
            class="timeframe-chip"
            classList={{ 'is-active': props.value === tf.value }}
            onClick={() => props.onChange(tf.value)}
          >
            {tf.label}
          </button>
        )}
      </For>
    </div>
  );
}
