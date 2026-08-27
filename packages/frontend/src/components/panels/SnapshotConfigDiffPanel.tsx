import { For, Show } from 'solid-js';
import {
  buildSnapshotConfigDiff,
  configDiffGroupLabel,
  type ConfigDiffGroup,
  type SnapshotConfigDiffInput,
  type SnapshotConfigMode,
} from '../../lib/snapshot-config-diff';

export interface SnapshotConfigDiffColumn {
  id: number;
  label: string;
}

interface Props {
  mode: SnapshotConfigMode;
  columns: SnapshotConfigDiffColumn[];
  snapshots: SnapshotConfigDiffInput[];
  loading?: boolean;
}

export function SnapshotConfigDiffPanel(props: Props) {
  const rows = () => buildSnapshotConfigDiff(props.mode, props.snapshots);

  const groupedRows = () => {
    const map = new Map<ConfigDiffGroup, ReturnType<typeof rows>>();
    for (const row of rows()) {
      const list = map.get(row.group) ?? [];
      list.push(row);
      map.set(row.group, list);
    }
    return [...map.entries()];
  };

  return (
    <section class="sim-snapshot-config-diff">
      <h4 class="sim-snapshot-config-diff-title">Diff configuration</h4>
      <p class="form-hint sim-snapshot-config-diff-hint">
        Paramètres Copy (lane) + Crypto Algo figés dans les snapshots — uniquement
        les valeurs qui diffèrent. Les snapshots antérieurs à cette version n’ont
        pas l’algo.
      </p>

      <Show when={props.loading}>
        <p class="form-hint">Chargement des détails config…</p>
      </Show>

      <Show when={!props.loading && props.snapshots.length < 2}>
        <p class="form-hint">Sélectionnez au moins 2 snapshots pour comparer la config.</p>
      </Show>

      <Show when={!props.loading && props.snapshots.length >= 2 && rows().length === 0}>
        <p class="empty-state sim-snapshot-config-diff-empty">
          Aucune différence de configuration entre les snapshots sélectionnés.
        </p>
      </Show>

      <Show when={!props.loading && rows().length > 0}>
        <div class="sim-snapshot-compare-scroll">
          <For each={groupedRows()}>
            {([group, groupRows]) => (
              <div class="sim-snapshot-config-diff-group">
                <h5 class="sim-snapshot-config-diff-group-title">
                  {configDiffGroupLabel(group)}
                </h5>
                <table class="sim-snapshot-compare sim-snapshot-config-diff-table">
                  <thead>
                    <tr>
                      <th>Paramètre</th>
                      <For each={props.columns}>
                        {(col) => <th>{col.label}</th>}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={groupRows}>
                      {(row) => (
                        <tr>
                          <td>{row.label}</td>
                          <For each={props.columns}>
                            {(col) => (
                              <td class="mono">
                                {row.valuesBySnapshotId.get(col.id) ?? '—'}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
