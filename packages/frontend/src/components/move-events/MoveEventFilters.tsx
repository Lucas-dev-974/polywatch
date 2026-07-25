import { For } from 'solid-js';
import {
  MOVE_EVENT_FILTER_OPTIONS,
  type ModeFilter,
} from '../../lib/move-events';

export type SourceFilter = 'all' | 'copy' | 'algo';

export const SOURCE_FILTER_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'copy', label: 'Copy' },
  { value: 'algo', label: 'Algo' },
];

interface MoveEventFiltersProps {
  modeFilter: () => ModeFilter;
  onFilterChange: (filter: ModeFilter) => void;
  sourceFilter: () => SourceFilter;
  onSourceFilterChange: (filter: SourceFilter) => void;
}

function FilterSegment<T extends string>(props: {
  label: string;
  value: () => T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="event-filter-group">
      <span class="event-filter-label">{props.label}</span>
      <div class="event-filter-segment" role="group" aria-label={props.label}>
        <For each={props.options}>
          {({ value, label }) => (
            <button
              type="button"
              class={`event-filter-segment-btn ${props.value() === value ? 'active' : ''}`}
              aria-pressed={props.value() === value}
              onClick={() => props.onChange(value)}
            >
              {label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export function MoveEventFilters(props: MoveEventFiltersProps) {
  return (
    <div class="event-filters">
      <FilterSegment
        label="Mode"
        value={props.modeFilter}
        options={MOVE_EVENT_FILTER_OPTIONS}
        onChange={props.onFilterChange}
      />
      <FilterSegment
        label="Source"
        value={props.sourceFilter}
        options={SOURCE_FILTER_OPTIONS}
        onChange={props.onSourceFilterChange}
      />
    </div>
  );
}
