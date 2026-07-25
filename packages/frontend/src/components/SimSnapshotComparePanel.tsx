import { createSignal, For, Show } from 'solid-js';
import {
  COMPARE_ROWS,
  buildTraderComparison,
  compareRowHasDiff,
  formatCompareDelta,
  formatPnlAmount,
  pnlClass,
  snapshotColumnLabel,
  type CompareDeltaMode,
  type CompareRow,
} from '../lib/sim-snapshot-compare';
import type {
  SimStateSnapshotDetail,
  SimStateSnapshotSummary,
} from '../lib/simulation-snapshots';
import { SnapshotConfigDiffPanel } from './SnapshotConfigDiffPanel';
import type { SnapshotConfigMode } from '../lib/snapshot-config-diff';

function CompareCell(props: {
  row: CompareRow;
  snapshot: SimStateSnapshotSummary;
  baseline: SimStateSnapshotSummary | undefined;
  detail?: SimStateSnapshotDetail;
  deltaMode: CompareDeltaMode;
}) {
  const valueClass = () => {
    if (props.row.pnlField) {
      return pnlClass(props.snapshot[props.row.pnlField]);
    }
    return '';
  };

  const delta = () => {
    const baseline = props.baseline;
    if (!baseline || props.snapshot.id === baseline.id) return undefined;
    if (!props.row.numeric) return undefined;
    const d = props.row.numeric(props.snapshot) - props.row.numeric(baseline);
    if (d === 0) return undefined;
    return d;
  };

  const deltaLabel = () => {
    const d = delta();
    const baseline = props.baseline;
    if (d == null || !baseline || !props.row.numeric) return null;
    return formatCompareDelta(
      d,
      props.deltaMode,
      props.row.numeric(baseline),
    );
  };

  return (
    <td>
      <span class={valueClass()}>{props.row.format(props.snapshot, props.detail)}</span>
      <Show when={deltaLabel()}>
        {(label) => (
          <span class={`sim-snapshot-delta ${pnlClass(delta()!)}`}>{label()}</span>
        )}
      </Show>
    </td>
  );
}

interface Props {
  selected: SimStateSnapshotSummary[];
  details: Map<number, SimStateSnapshotDetail>;
  referenceId: number | null;
  onReferenceChange: (id: number) => void;
  /** Defaults to sim — pass `real` from RealSnapshotsPanel. */
  configMode?: SnapshotConfigMode;
}

export function SimSnapshotComparePanel(props: Props) {
  const [deltaMode, setDeltaMode] = createSignal<CompareDeltaMode>('absolute');
  const [showTraderDiff, setShowTraderDiff] = createSignal(false);
  const configMode = () => props.configMode ?? 'sim';

  const baseline = () => {
    const id = props.referenceId;
    if (id != null) {
      return props.selected.find((s) => s.id === id) ?? props.selected[0];
    }
    return props.selected[0];
  };

  const configDiffInputs = () =>
    props.selected.map((s) => ({
      snapshotId: s.id,
      config: props.details.get(s.id)?.config as Record<string, unknown> | undefined,
    }));

  const configDetailsReady = () =>
    props.selected.length >= 2 &&
    props.selected.every((s) => props.details.has(s.id));

  const traderDiffPair = () => {
    if (props.selected.length !== 2) return null;
    const ref = baseline();
    const other = props.selected.find((s) => s.id !== ref?.id);
    if (!ref || !other) return null;
    const refDetail = props.details.get(ref.id);
    const otherDetail = props.details.get(other.id);
    if (!refDetail || !otherDetail) return null;
    return { ref, other, rows: buildTraderComparison(refDetail, otherDetail) };
  };

  return (
    <section class="sim-snapshot-compare-section">
      <div class="sim-snapshot-compare-wrap">
        <h3 class="sim-snapshot-compare-title">Comparaison avancée</h3>

        <Show when={props.selected.length >= 2}>
          <div class="sim-snapshot-compare-controls">
            <label class="sim-snapshot-compare-control">
              <span class="sim-snapshot-filter-label">Référence</span>
              <select
                class="input input-sm"
                value={baseline()?.id ?? ''}
                onChange={(e) => props.onReferenceChange(Number(e.currentTarget.value))}
              >
                <For each={props.selected}>
                  {(s) => (
                    <option value={s.id}>{snapshotColumnLabel(s)}</option>
                  )}
                </For>
              </select>
            </label>
            <div class="sim-snapshot-compare-mode">
              <button
                type="button"
                class={`btn btn-sm ${deltaMode() === 'absolute' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDeltaMode('absolute')}
              >
                Δ absolu
              </button>
              <button
                type="button"
                class={`btn btn-sm ${deltaMode() === 'percent' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDeltaMode('percent')}
              >
                Δ %
              </button>
            </div>
          </div>
          <p class="form-hint sim-snapshot-compare-hint">
            Deltas par rapport au snapshot de référence. Les lignes identiques
            sont atténuées.
          </p>
        </Show>

        <div class="sim-snapshot-compare-scroll">
          <table class="sim-snapshot-compare">
            <thead>
              <tr>
                <th>Métrique</th>
                <For each={props.selected}>
                  {(s) => <th>{snapshotColumnLabel(s)}</th>}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={COMPARE_ROWS}>
                {(row) => {
                  const hasDiff = () =>
                    compareRowHasDiff(row, props.selected, props.details);
                  return (
                    <tr
                      classList={{
                        'sim-snapshot-compare-row-same':
                          props.selected.length >= 2 && !hasDiff(),
                      }}
                    >
                      <td>{row.label}</td>
                      <For each={props.selected}>
                        {(s) => (
                          <CompareCell
                            row={row}
                            snapshot={s}
                            baseline={baseline()}
                            detail={props.details.get(s.id)}
                            deltaMode={deltaMode()}
                          />
                        )}
                      </For>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>

        <Show when={props.selected.length === 2}>
          <div class="sim-snapshot-trader-diff">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => setShowTraderDiff((v) => !v)}
            >
              {showTraderDiff() ? 'Masquer' : 'Afficher'} comparaison traders
            </button>
            <Show when={showTraderDiff() && traderDiffPair()}>
              {(pair) => (
                <div class="sim-snapshot-trader-diff-table-wrap panel-scroll">
                  <p class="form-hint">
                    {snapshotColumnLabel(pair().ref)} →{' '}
                    {snapshotColumnLabel(pair().other)}
                  </p>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Trader</th>
                        <th>PnL réalisé Δ</th>
                        <th>PnL ouvert Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={pair().rows}>
                        {(row) => (
                          <tr>
                            <td>{row.label}</td>
                            <td class={pnlClass(row.deltaRealized)}>
                              {formatPnlAmount(row.deltaRealized, true)}
                            </td>
                            <td class={pnlClass(row.deltaUnrealized)}>
                              {formatPnlAmount(row.deltaUnrealized, true)}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              )}
            </Show>
            <Show when={showTraderDiff() && !traderDiffPair()}>
              <p class="form-hint">Chargement des détails…</p>
            </Show>
          </div>
        </Show>

        <Show when={props.selected.length >= 2}>
          <SnapshotConfigDiffPanel
            mode={configMode()}
            columns={props.selected.map((s) => ({
              id: s.id,
              label: snapshotColumnLabel(s),
            }))}
            snapshots={configDiffInputs()}
            loading={!configDetailsReady()}
          />
        </Show>
      </div>
    </section>
  );
}
