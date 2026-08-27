import { For, Show } from 'solid-js';
import { formatShortDateTime } from '../../lib/date';
import {
  closeExecutionErrorLabel,
  executionReasonLabel,
  executionStatusClass,
  executionStatusLabel,
  formatExecutionCashImpact,
} from '../../lib/execution';
import type { useCryptoAlgoExecutions } from '../../hooks/useCryptoAlgoExecutions';
import { Icon } from '../Icon';

type ExecutionsState = ReturnType<typeof useCryptoAlgoExecutions>;

export interface CryptoAlgoExecutionsPanelProps {
  executions: ExecutionsState;
}

function marketLabel(item: { marketQuestion?: string | null; conditionId?: string | null }): string {
  if (item.marketQuestion) return item.marketQuestion;
  if (item.conditionId) return `${item.conditionId.slice(0, 12)}…`;
  return '—';
}

export function CryptoAlgoExecutionsPanel(props: CryptoAlgoExecutionsPanelProps) {
  const ex = () => props.executions;

  const hasActiveFilters = () => ex().modeFilter() !== 'all' || ex().statusFilter() !== 'all';

  const emptyMessage = () =>
    hasActiveFilters()
      ? 'Aucune exécution pour ces filtres.'
      : 'Aucune exécution algo enregistrée.';

  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">
          <Icon name="activity" />
          Exécutions de l'algo
        </h2>
        <div class="algo-panel-header-right">
          <div class="algo-pos-mode-tabs">
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().modeFilter() === 'all' ? 'active' : ''}`}
              onClick={() => ex().setModeFilter('all')}
            >
              Tous
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().modeFilter() === 'sim' ? 'active' : ''}`}
              onClick={() => ex().setModeFilter('sim')}
            >
              Sim
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().modeFilter() === 'real' ? 'active' : ''}`}
              onClick={() => ex().setModeFilter('real')}
            >
              Réel
            </button>
          </div>
          <div class="algo-pos-mode-tabs">
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().statusFilter() === 'all' ? 'active' : ''}`}
              onClick={() => ex().setStatusFilter('all')}
            >
              Tous
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().statusFilter() === 'filled' ? 'active' : ''}`}
              onClick={() => ex().setStatusFilter('filled')}
            >
              Remplies
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().statusFilter() === 'failed' ? 'active' : ''}`}
              onClick={() => ex().setStatusFilter('failed')}
            >
              Échouées
            </button>
            <button
              type="button"
              class={`algo-pos-mode-tab ${ex().statusFilter() === 'pending' ? 'active' : ''}`}
              onClick={() => ex().setStatusFilter('pending')}
            >
              En cours
            </button>
          </div>
          <Show when={ex().total() > 0}>
            <div class="algo-pagination">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={ex().page() === 0}
                onClick={() => ex().goToPage(ex().page() - 1)}
                aria-label="Page précédente"
              >
                <Icon name="chevron-left" size={16} />
              </button>
              <span class="algo-pagination-info">
                {ex().page() + 1} / {ex().pageCount()}
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={ex().page() >= ex().pageCount() - 1}
                onClick={() => ex().goToPage(ex().page() + 1)}
                aria-label="Page suivante"
              >
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          </Show>
          <span class="algo-panel-count">{ex().total()} exécutions</span>
        </div>
      </div>
      <Show
        when={ex().executions().length > 0}
        fallback={<div class="algo-empty">{emptyMessage()}</div>}
      >
        <div class="algo-table-wrap">
          <table class="algo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Marché</th>
                <th>Side</th>
                <th>Raison</th>
                <th>Mode</th>
                <th>Statut</th>
                <th>Fill</th>
                <th>Impact</th>
                <th>Erreur</th>
              </tr>
            </thead>
            <tbody>
              <For each={ex().executions()}>
                {(item) => {
                  const impact = formatExecutionCashImpact(item);
                  const errorLabel =
                    item.status === 'failed' ? closeExecutionErrorLabel(item.error) : null;
                  return (
                    <tr>
                      <td class="text-mono text-sm">
                        {item.executedAt ? formatShortDateTime(item.executedAt) : '—'}
                      </td>
                      <td class="cell-truncate" title={marketLabel(item)}>
                        <span>{marketLabel(item)}</span>
                        <Show when={item.outcome}>
                          {(outcome) => (
                            <span class="algo-badge" style={{ 'margin-left': '0.375rem' }}>
                              {outcome()}
                            </span>
                          )}
                        </Show>
                      </td>
                      <td>
                        <span class={`algo-side-badge ${item.side === 'BUY' ? 'buy' : 'sell'}`}>
                          {item.side}
                        </span>
                      </td>
                      <td class="text-sm">{executionReasonLabel(item.reason)}</td>
                      <td>
                        <span class={`algo-mode-badge ${item.mode}`}>
                          {item.mode === 'real' ? 'Réel' : 'Sim'}
                        </span>
                      </td>
                      <td class="text-sm">
                        <span class={`algo-status-dot-sm ${executionStatusClass(item.status)}`} />
                        {executionStatusLabel(item.status)}
                      </td>
                      <td class="text-mono text-sm">
                        {item.fillQuantity != null
                          ? `${item.fillQuantity.toFixed(2)} @ ${item.fillPrice?.toFixed(4)}`
                          : '—'}
                      </td>
                      <td class={impact?.className ?? 'text-mono text-sm'}>
                        {impact?.text ?? '—'}
                      </td>
                      <td class="text-sm cell-truncate" title={errorLabel ?? undefined}>
                        {errorLabel ?? '—'}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
