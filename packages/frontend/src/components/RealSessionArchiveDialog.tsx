import { createEffect, createSignal, For, Show } from 'solid-js';
import type { RealArchiveType } from '@polywatch/core';
import { formatShortDateTime } from '../lib/date';
import type { RealSessionSummary } from '../lib/real-sessions';
import {
  fetchRealSessionArchive,
  type RealArchiveExecutionDto,
  type RealArchiveExitAttemptDto,
  type RealArchivePositionDto,
  type RealArchiveSummary,
} from '../lib/real-session-archive';
import { Dialog } from './Dialog';

const ARCHIVE_TABS: { id: RealArchiveType; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'executions', label: 'Exécutions' },
  { id: 'exit_attempts', label: 'Sorties' },
];

interface Props {
  open: boolean;
  session: RealSessionSummary | null;
  onClose: () => void;
}

export function RealSessionArchiveDialog(props: Props) {
  const [tab, setTab] = createSignal<RealArchiveType>('positions');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [summary, setSummary] = createSignal<RealArchiveSummary | null>(null);
  const [items, setItems] = createSignal<unknown[]>([]);
  const [total, setTotal] = createSignal(0);

  async function loadArchive() {
    const session = props.session;
    if (!session || !props.open) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRealSessionArchive(session.id, tab(), { limit: 100 });
      setSummary(data.summary);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du chargement');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    if (props.open && props.session) {
      tab();
      void loadArchive();
    }
  });

  const title = () => {
    const s = props.session;
    if (!s) return 'Archive période';
    return `Archive · ${s.label?.trim() || `Période #${s.id}`}`;
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={title()}
      titleId="real-session-archive-dialog-title"
      class="dialog-metrics sim-session-archive-dialog"
      bodyClass="dialog-body-metrics"
    >
      <Show when={props.session}>
        {(session) => (
          <>
            <Show when={summary() ?? session().archiveSummary}>
              {(s) => (
                <p class="form-hint sim-session-archive-summary">
                  {s().positions} positions · {s().executions} exécutions ·{' '}
                  {s().exitAttempts} tentatives
                  {s().periodFrom && s().periodTo
                    ? ` · ${formatShortDateTime(s().periodFrom!)} → ${formatShortDateTime(s().periodTo!)}`
                    : ''}
                </p>
              )}
            </Show>

            <div class="panel-tabs sim-session-archive-tabs">
              <For each={ARCHIVE_TABS}>
                {(t) => (
                  <button
                    type="button"
                    class={`panel-tab ${tab() === t.id ? 'active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                )}
              </For>
            </div>

            <Show when={loading()}>
              <p class="form-hint">Chargement…</p>
            </Show>
            <Show when={error()}>
              <p class="form-error">{error()}</p>
            </Show>

            <Show when={!loading() && !error()}>
              <p class="form-hint">{total()} élément(s)</p>
              <div class="table-wrap sim-session-archive-table-wrap">
                <Show when={tab() === 'positions'}>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Marché</th>
                        <th>Outcome</th>
                        <th>Size</th>
                        <th>PnL</th>
                        <th>Close</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={items() as RealArchivePositionDto[]}>
                        {(row) => (
                          <tr>
                            <td class="mono">{row.conditionId.slice(0, 10)}…</td>
                            <td>{row.outcome}</td>
                            <td class="mono">{row.size}</td>
                            <td class="mono">{row.realizedPnl}</td>
                            <td>{row.closeReason ?? '—'}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={tab() === 'executions'}>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Pos</th>
                        <th>Side</th>
                        <th>Fill</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={items() as RealArchiveExecutionDto[]}>
                        {(row) => (
                          <tr>
                            <td>{row.copiedPositionId}</td>
                            <td>{row.side}</td>
                            <td class="mono">{row.fillPrice ?? '—'}</td>
                            <td>{row.status}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={tab() === 'exit_attempts'}>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Pos</th>
                        <th>Kind</th>
                        <th>Reason</th>
                        <th>At</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={items() as RealArchiveExitAttemptDto[]}>
                        {(row) => (
                          <tr>
                            <td>{row.copiedPositionId}</td>
                            <td>{row.kind}</td>
                            <td>{row.closeReason}</td>
                            <td>{formatShortDateTime(row.createdAt)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
    </Dialog>
  );
}
