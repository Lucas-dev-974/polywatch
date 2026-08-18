import { For, Show } from 'solid-js';
import { WEATHER_ALGO_TIMELINE_MAX_TICKS } from '../../lib/ui-persistence';
import type { WeatherTimelineDateEntry, WeatherTimelineSource } from '../weather-timeline-types';

export function TimelineBar<TCity extends object>(props: {
  source: WeatherTimelineSource<TCity>;
  dates: WeatherTimelineDateEntry[];
  selectedDate: string;
  side: string;
  fidelity: string;
  maxTicks: number;
  loading: boolean;
  onDateChange: (value: string) => void;
  onSideChange: (value: string) => void;
  onFidelityChange: (value: string) => void;
  onMaxTicksChange: (value: number) => void;
  onRefresh: () => void;
  canStep: (dir: number) => boolean;
  stepDate: (dir: number) => void;
}) {
  const s = props.source;
  return (
    <div class="weather-bucket-timeline-bar">
      <div class="weather-bucket-timeline-date">
        <span class="weather-data-filter-label">Date cible</span>
        <div class="weather-bucket-timeline-date-control">
          <button
            type="button"
            class="weather-bucket-timeline-step"
            aria-label="Date précédente"
            onClick={() => props.stepDate(-1)}
            disabled={props.loading || !props.canStep(-1)}
          >
            ‹
          </button>
          <select
            class="weather-bucket-timeline-date-select"
            value={props.selectedDate}
            onChange={(e) => props.onDateChange(e.currentTarget.value)}
            disabled={props.loading}
          >
            <Show when={props.dates.length === 0}>
              <option value="">Aucune date</option>
            </Show>
            <For each={props.dates}>
              {(d) => <option value={d.key}>{d.label}</option>}
            </For>
          </select>
          <button
            type="button"
            class="weather-bucket-timeline-step"
            aria-label="Date suivante"
            onClick={() => props.stepDate(1)}
            disabled={props.loading || !props.canStep(1)}
          >
            ›
          </button>
        </div>
      </div>
      <Show when={s.sideOptions}>
        <label class="weather-data-filter">
          <span>Côté</span>
          <select
            value={props.side}
            onChange={(e) => props.onSideChange(e.currentTarget.value)}
            disabled={props.loading}
          >
            <For each={s.sideOptions!}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </select>
        </label>
      </Show>
      <Show when={s.fidelityOptions}>
        <label class="weather-data-filter">
          <span>Intervalle</span>
          <select
            value={props.fidelity}
            onChange={(e) => props.onFidelityChange(e.currentTarget.value)}
            disabled={props.loading}
          >
            <Show when={!s.fidelityRequired}>
              <option value="">Tous</option>
            </Show>
            <For each={s.fidelityOptions!}>
              {(o) => <option value={o.value}>{o.label}</option>}
            </For>
          </select>
        </label>
      </Show>
      <div class="weather-bucket-timeline-maxticks">
        <span class="weather-data-filter-label">Points max</span>
        <div class="weather-bucket-timeline-segmented" role="group" aria-label="Points max">
          <For each={WEATHER_ALGO_TIMELINE_MAX_TICKS}>
            {(v) => (
              <button
                type="button"
                class={`weather-bucket-timeline-seg-btn${props.maxTicks === v ? ' active' : ''}`}
                onClick={() => props.onMaxTicksChange(v)}
                disabled={props.loading}
              >
                {v.toLocaleString()}
              </button>
            )}
          </For>
        </div>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" onClick={props.onRefresh}>
        Actualiser
      </button>
    </div>
  );
}
