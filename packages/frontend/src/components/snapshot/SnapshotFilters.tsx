import { Show } from 'solid-js';
import type { SnapshotFiltersShape } from '../../hooks/useSnapshots';

interface SourceOption {
  value: string;
  label: string;
}

interface Props {
  filters: SnapshotFiltersShape;
  /** Options de la liste Source (sim: reset, real: rotate). */
  sourceOptions: SourceOption[];
  onSourceChange: (source: string | undefined) => void;
  onLabelChange: (label: string) => void;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onClear: () => void;
}

export function SnapshotFilters(props: Props) {
  const hasActiveFilters = () => {
    const f = props.filters;
    return (
      (f.source && f.source !== 'all') ||
      Boolean(f.label?.trim()) ||
      Boolean(f.from) ||
      Boolean(f.to)
    );
  };

  return (
    <div class="sim-snapshot-filters">
      <label class="sim-snapshot-filter">
        <span class="sim-snapshot-filter-label">Source</span>
        <select
          class="input input-sm"
          value={props.filters.source ?? 'all'}
          onChange={(e) => props.onSourceChange(e.currentTarget.value)}
        >
          <option value="all">Toutes</option>
          {props.sourceOptions.map((o) => (
            <option value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label class="sim-snapshot-filter sim-snapshot-filter-grow">
        <span class="sim-snapshot-filter-label">Label</span>
        <input
          class="input input-sm"
          type="search"
          placeholder="Rechercher…"
          value={props.filters.label ?? ''}
          onInput={(e) => props.onLabelChange(e.currentTarget.value)}
        />
      </label>
      <label class="sim-snapshot-filter">
        <span class="sim-snapshot-filter-label">Du</span>
        <input
          class="input input-sm"
          type="date"
          value={props.filters.from ?? ''}
          onChange={(e) => props.onFromChange(e.currentTarget.value)}
        />
      </label>
      <label class="sim-snapshot-filter">
        <span class="sim-snapshot-filter-label">Au</span>
        <input
          class="input input-sm"
          type="date"
          value={props.filters.to ?? ''}
          onChange={(e) => props.onToChange(e.currentTarget.value)}
        />
      </label>
      <Show when={hasActiveFilters()}>
        <button
          type="button"
          class="btn btn-ghost btn-sm sim-snapshot-filter-clear"
          onClick={() => props.onClear()}
        >
          Effacer filtres
        </button>
      </Show>
    </div>
  );
}
