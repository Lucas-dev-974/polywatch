import { createSignal, For, onMount, onCleanup, Show } from 'solid-js';
import { api } from '../api';
import { formatShortDateTime } from '../lib/date';
import { connectSocket } from '../socket';
import { type Execution, executionStatusClass, formatExecutionCashImpact } from '../lib/execution';
import { CollapsiblePanel, useCollapse } from './CollapsiblePanel';
import { Icon } from './Icon';

type Props = {
  mode: 'sim' | 'real';
};

interface ExecutionsResponse {
  items: Execution[];
  total: number;
}

const PAGE_SIZE = 20;

export function ExecutionLog(props: Props) {
  const [executions, setExecutions] = createSignal<Execution[]>([]);
  const [total, setTotal] = createSignal(0);
  const [collapsed, setCollapsed] = useCollapse('executions', props.mode);
  const [page, setPage] = createSignal(0);

  function buildQuery(): string {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page() * PAGE_SIZE));
    params.set('mode', props.mode);
    params.set('sortBy', 'executedAt');
    params.set('hasExecutedAt', 'true');
    return `/executions?${params.toString()}`;
  }

  async function load() {
    const data = await api<ExecutionsResponse>(buildQuery());
    setExecutions(data.items);
    setTotal(data.total);
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(0, Math.ceil(total() / PAGE_SIZE) - 1);
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void load();
  }

  const pageCount = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));

  function countLabel(): string {
    const all = total();
    if (all === 0) return '0';
    return `${all} enregistré${all !== 1 ? 's' : ''}`;
  }

  function paginationLabel(): string {
    const current = page() + 1;
    const pages = pageCount();
    return `Page ${current} / ${pages}`;
  }

  onMount(() => {
    void load();
    const socket = connectSocket();
    // Handler references required: bare socket.off('event') would remove
    // the listeners of other components sharing the socket.
    const onExecution = () => void load();
    const onSimulationReset = () => void load();
    socket.on('execution', onExecution);
    socket.on('simulation_reset', onSimulationReset);
    onCleanup(() => {
      socket.off('execution', onExecution);
      socket.off('simulation_reset', onSimulationReset);
    });
  });

  return (
    <section class="panel">
      <div class="panel-header">
        <h2>Exécutions</h2>
        <div class="event-header-actions">
          <Show when={total() > 0}>
            <div class="event-pagination event-pagination--header">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={page() === 0}
                onClick={() => goToPage(page() - 1)}
              >
                ← Précédent
              </button>
              <span class="event-pagination-info">{paginationLabel()}</span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={page() >= pageCount() - 1}
                onClick={() => goToPage(page() + 1)}
              >
                Suivant →
              </button>
            </div>
          </Show>
          <span class="panel-count">{countLabel()}</span>
          <button
            class="panel-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed() ? 'Déplier' : 'Plier'}
          >
            <Icon name={collapsed() ? 'chevron-down' : 'chevron-up'} />
          </button>
        </div>
      </div>

      <CollapsiblePanel collapsed={collapsed()}>
        <div class="panel-body-flush panel-scroll">
          <Show
            when={executions().length > 0}
            fallback={
              <div class="empty-state">
                <div class="empty-state-icon">▤</div>
                Aucune exécution récente
              </div>
            }
          >
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Side</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Fill</th>
                    <th>Mise/Gain/Perte</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={executions()}>
                    {(ex) => {
                      const impact = formatExecutionCashImpact(ex);
                      return (
                        <tr>
                          <td class="text-mono" style={{ 'font-size': '0.75rem' }}>
                            {formatShortDateTime(ex.executedAt)}
                          </td>
                          <td style={{ 'text-transform': 'uppercase', 'font-weight': '500' }}>
                            {ex.side}
                          </td>
                          <td>{ex.reason}</td>
                          <td class={executionStatusClass(ex.status)}>{ex.status}</td>
                          <td class="text-mono">
                            {ex.fillQuantity != null
                              ? `${ex.fillQuantity.toFixed(2)} @ ${ex.fillPrice?.toFixed(4)}`
                              : '—'}
                          </td>
                          <td class={impact?.className ?? 'text-mono'}>
                            {impact?.text ?? '—'}
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>
      </CollapsiblePanel>
    </section>
  );
}
