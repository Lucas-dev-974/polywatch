import { createSignal, For, Show } from 'solid-js';
import {
  formatCompareDelta,
  formatPnlAmount,
  pnlClass,
  SESSION_COMPARE_ROWS,
  sessionColumnLabel,
  sessionCompareRowHasDiff,
  type CompareDeltaMode,
  type SessionCompareRow,
} from '../../lib/sim-session-compare';
import type { SimSessionSummary } from '../../lib/simulation-sessions';

function SessionCompareCell(props: {
  row: SessionCompareRow;
  session: SimSessionSummary;
  baseline: SimSessionSummary | undefined;
  deltaMode: CompareDeltaMode;
}) {
  const valueClass = () => {
    if (!props.row.pnlField || !props.row.numeric) return '';
    return pnlClass(props.row.numeric(props.session));
  };

  const delta = () => {
    const baseline = props.baseline;
    if (!baseline || props.session.id === baseline.id) return undefined;
    if (!props.row.numeric) return undefined;
    const d = props.row.numeric(props.session) - props.row.numeric(baseline);
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
      <span class={valueClass()}>{props.row.format(props.session)}</span>
      <Show when={deltaLabel()}>
        {(label) => (
          <span class={`sim-snapshot-delta ${pnlClass(delta()!)}`}>
            {label()}
          </span>
        )}
      </Show>
    </td>
  );
}

interface Props {
  selected: SimSessionSummary[];
  referenceId: number | null;
  onReferenceChange: (id: number) => void;
  onClear: () => void;
}

export function SimSessionComparePanel(props: Props) {
  const [deltaMode, setDeltaMode] = createSignal<CompareDeltaMode>('absolute');

  const baseline = () => {
    const id = props.referenceId;
    if (id != null) {
      return props.selected.find((s) => s.id === id) ?? props.selected[0];
    }
    return props.selected[0];
  };

  return (
    <section class="sim-snapshot-compare-section">
      <div class="sim-snapshot-compare-wrap">
        <div class="sim-session-compare-header">
          <h3 class="sim-snapshot-compare-title">Comparaison de sessions</h3>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onClick={() => props.onClear()}
          >
            Effacer sélection
          </button>
        </div>

        <Show
          when={props.selected.length >= 2}
          fallback={
            <p class="form-hint">
              Sélectionnez au moins 2 sessions pour comparer PnL, durée, peak /
              trough et nombre de snapshots.
            </p>
          }
        >
          <div class="sim-snapshot-compare-controls">
            <label class="sim-snapshot-compare-control">
              <span class="sim-snapshot-filter-label">Référence</span>
              <select
                class="input input-sm"
                value={baseline()?.id ?? ''}
                onChange={(e) =>
                  props.onReferenceChange(Number(e.currentTarget.value))
                }
              >
                <For each={props.selected}>
                  {(s) => (
                    <option value={s.id}>{sessionColumnLabel(s)}</option>
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
            Deltas par rapport à la session de référence. Les lignes identiques
            sont atténuées.
          </p>
        </Show>

        <Show when={props.selected.length >= 1}>
          <div class="sim-snapshot-compare-scroll">
            <table class="sim-snapshot-compare">
              <thead>
                <tr>
                  <th>Métrique</th>
                  <For each={props.selected}>
                    {(s) => <th>{sessionColumnLabel(s)}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={SESSION_COMPARE_ROWS}>
                  {(row) => {
                    const hasDiff = () =>
                      sessionCompareRowHasDiff(row, props.selected);
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
                            <SessionCompareCell
                              row={row}
                              session={s}
                              baseline={baseline()}
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
        </Show>

        <Show when={props.selected.length === 2 && baseline()}>
          {(ref) => {
            const other = () =>
              props.selected.find((s) => s.id !== ref().id) ?? props.selected[1];
            const pnlDelta = () => {
              const a = ref().sessionPnl ?? ref().endingSessionPnl ?? 0;
              const b =
                other().sessionPnl ?? other().endingSessionPnl ?? 0;
              return b - a;
            };
            return (
              <div class="sim-session-compare-summary">
                <span class="form-hint">
                  {sessionColumnLabel(other())} vs référence
                </span>
                <span class={`mono ${pnlClass(pnlDelta())}`}>
                  Δ PnL {formatPnlAmount(pnlDelta(), true)}
                </span>
              </div>
            );
          }}
        </Show>
      </div>
    </section>
  );
}
