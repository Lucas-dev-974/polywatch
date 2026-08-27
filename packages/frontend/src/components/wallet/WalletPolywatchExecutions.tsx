import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { api } from '../../api';
import { formatShortDateTime } from '../../lib/date';
import {
  type Execution,
  executionStatusClass,
  executionStatusLabel,
} from '../../lib/execution';
import { connectSocket } from '../../socket';

interface ExecutionsResponse {
  items: Execution[];
  total: number;
}

const PAGE_SIZE = 20;

export function WalletPolywatchExecutions() {
  const [executions, setExecutions] = createSignal<Execution[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(0);

  async function load() {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page() * PAGE_SIZE));
      params.set('mode', 'real');
      params.set('sortBy', 'executedAt');
      params.set('hasExecutedAt', 'true');

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      params.set('from', thirtyDaysAgo.toISOString());

      const data = await api<ExecutionsResponse>(`/executions?${params.toString()}`);
      setExecutions(data.items);
      setTotal(data.total);
    } catch {
      setExecutions([]);
      setTotal(0);
    }
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(0, Math.ceil(total() / PAGE_SIZE) - 1);
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void load();
  }

  const pageCount = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));

  function paginationLabel(): string {
    const current = page() + 1;
    const pages = pageCount();
    return `Page ${current} / ${pages}`;
  }

  onMount(() => {
    void load();
    const socket = connectSocket();
    const onExecution = () => void load();
    socket.on('execution', onExecution);
    onCleanup(() => socket.off('execution', onExecution));
  });

  return (
    <div class="panel-body-flush">
      <Show
        when={executions().length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">{'{ }'}</div>
            Aucune execution Polywatch recente
          </div>
        }
      >
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Side</th>
                <th>Raison</th>
                <th>Statut</th>
                <th>Prix</th>
                <th>Qte</th>
              </tr>
            </thead>
            <tbody>
              <For each={executions()}>
                {(ex) => (
                  <tr>
                    <td class="text-mono" style="font-size: 0.75rem;">
                      {formatShortDateTime(ex.executedAt)}
                    </td>
                    <td style="text-transform: uppercase; font-weight: 500;">
                      {ex.side}
                    </td>
                    <td class="table-cell-ellipsis">{ex.reason}</td>
                    <td class={executionStatusClass(ex.status)}>
                      {executionStatusLabel(ex.status)}
                    </td>
                    <td class="text-mono">
                      {ex.fillPrice != null ? ex.fillPrice.toFixed(4) : '—'}
                    </td>
                    <td class="text-mono">
                      {ex.fillQuantity != null ? ex.fillQuantity.toFixed(2) : '—'}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        <div class="event-pagination">
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
    </div>
  );
}
