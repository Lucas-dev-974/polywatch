import { Show } from 'solid-js';
import type { RealSnapshotListFilters } from '../lib/real-snapshots';

interface Props {
  filters: RealSnapshotListFilters;
  onSourceChange: (source: RealSnapshotListFilters['source']) => void;
  onLabelChange: (label: string) => void;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onClear: () => void;
}

export function RealSnapshotFilters(props: Props) {
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
          onChange={(e) =>
            props.onSourceChange(
              e.currentTarget.value as RealSnapshotListFilters['source'],
            )
          }
        >
          <option value="all">Toutes</option>
          <option value="manual">Manuel</option>
          <option value="auto">Automatique</option>
          <option value="rotate">Clôture période</option>
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
