import { createEffect, createSignal, For, Show } from 'solid-js';
import type { SimArchiveType } from '@polywatch/core';
import { formatShortDateTime } from '../../lib/date';
import type { SimSessionSummary } from '../../lib/simulation-sessions';
import {
  fetchSessionArchive,
  type SimArchiveCandleDto,
  type SimArchiveExecutionDto,
  type SimArchiveExitAttemptDto,
  type SimArchivePositionDto,
  type SimArchiveSummary,
  type SimArchiveSurveillanceDto,
} from '../../lib/simulation-session-archive';
import { Dialog } from '../Dialog';

const ARCHIVE_TABS: { id: SimArchiveType; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'executions', label: 'Exécutions' },
  { id: 'exit_attempts', label: 'Sorties' },
  { id: 'surveillance', label: 'Surveillance' },
  { id: 'candles', label: 'Bougies' },
];

interface Props {
  open: boolean;
  session: SimSessionSummary | null;
  onClose: () => void;
}

export function SimSessionArchiveDialog(props: Props) {
  const [tab, setTab] = createSignal<SimArchiveType>('positions');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [summary, setSummary] = createSignal<SimArchiveSummary | null>(null);
  const [items, setItems] = createSignal<unknown[]>([]);
  const [total, setTotal] = createSignal(0);

  async function loadArchive() {
    const session = props.session;
    if (!session || !props.open) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSessionArchive(session.id, tab(), { limit: 100 });
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
    if (!s) return 'Archive session';
    return `Archive · ${s.label?.trim() || `Session #${s.id}`}`;
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={title()}
      titleId="sim-session-archive-dialog-title"
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
                  {s().exitAttempts} tentatives · {s().surveillance} surveillance ·{' '}
                  {s().candles} bougies
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
                      <For each={items() as SimArchivePositionDto[]}>
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
                      <For each={items() as SimArchiveExecutionDto[]}>
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
                      <For each={items() as SimArchiveExitAttemptDto[]}>
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
                <Show when={tab() === 'surveillance'}>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Marché</th>
                        <th>Symbole</th>
                        <th>Interval</th>
                        <th>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={items() as SimArchiveSurveillanceDto[]}>
                        {(row) => (
                          <tr>
                            <td class="mono">{row.conditionId.slice(0, 10)}…</td>
                            <td>{row.cryptoSymbol ?? '—'}</td>
                            <td>{row.interval ?? '—'}</td>
                            <td>{row.winningOutcome ?? '—'}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={tab() === 'candles'}>
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Bucket</th>
                        <th>O/H/L/C</th>
                        <th>Ticks</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={items() as SimArchiveCandleDto[]}>
                        {(row) => (
                          <tr>
                            <td>{row.source}</td>
                            <td>{formatShortDateTime(row.bucketStart)}</td>
                            <td class="mono">
                              {row.open}/{row.high}/{row.low}/{row.close}
                            </td>
                            <td>{row.tickCount}</td>
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
