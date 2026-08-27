import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { truncateAddress } from '../../lib/address';
import { formatTimestampMs } from '../../lib/date';
import { primaryWalletAccount, type WalletAccountView } from '../../lib/wallet';
import {
  fetchWalletHistory,
  formatWalletHistoryError,
  walletHistoryCategoryClass,
  walletHistoryCategoryLabel,
  type WalletHistoryEntry,
} from '../../lib/wallet-history';

interface WalletHistoryPanelProps {
  accounts: WalletAccountView[];
}

export function WalletHistoryPanel(props: WalletHistoryPanelProps) {
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [entries, setEntries] = createSignal<WalletHistoryEntry[]>([]);
  const [queriedAddress, setQueriedAddress] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.accounts,
      (accounts) => {
        if (!accounts.length) {
          setSelectedId(null);
          return;
        }
        const current = selectedId();
        if (current == null || !accounts.some((a) => a.id === current)) {
          setSelectedId(primaryWalletAccount(accounts)?.id ?? null);
        }
      },
    ),
  );

  async function load(accountId: number | null = selectedId()) {
    if (accountId == null) {
      setEntries([]);
      setQueriedAddress(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchWalletHistory(accountId, { limit: 50 });
      setEntries(data.entries);
      setQueriedAddress(data.queriedAddress);
    } catch (err) {
      setEntries([]);
      setQueriedAddress(null);
      setError(formatWalletHistoryError(err));
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    on(
      () => selectedId(),
      (accountId) => {
        void load(accountId);
      },
    ),
  );

  return (
    <div class="wallet-history-panel">
      <div class="wallet-history-toolbar">
        <label class="wallet-history-select-wrap">
          <span class="wallet-history-select-label">Wallet</span>
          <select
            class="input wallet-history-select"
            value={selectedId() ?? ''}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              setSelectedId(Number.isInteger(next) && next > 0 ? next : null);
            }}
          >
            <For each={props.accounts}>
              {(account) => (
                <option value={account.id}>
                  {account.label}
                  {account.isPrimary ? ' (principal)' : ''}
                </option>
              )}
            </For>
          </select>
        </label>

        <button
          class="btn btn-secondary btn-sm"
          disabled={loading() || selectedId() == null}
          onClick={() => void load()}
        >
          {loading() ? 'Chargement...' : 'Actualiser'}
        </button>
      </div>

      <Show when={queriedAddress()}>
        <p class="form-hint wallet-history-address-hint">
          Activite Polymarket pour le depot{' '}
          <span class="text-mono">{truncateAddress(queriedAddress()!)}</span>
        </p>
      </Show>

      <Show when={error()}>
        <div class="alert alert-warning wallet-history-error">
          {error()}
        </div>
      </Show>

      <div class="wallet-history-body">
        <Show
          when={!loading() && entries().length > 0}
          fallback={
            <Show when={!loading() && !error()}>
              <div class="empty-state">
                <div class="empty-state-icon">{'{ }'}</div>
                Aucune activite on-chain pour ce wallet
              </div>
            </Show>
          }
        >
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Montant</th>
                  <th>Prix</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                <For each={entries()}>
                  {(entry) => (
                    <tr>
                      <td class="text-mono table-cell-date">
                        {formatTimestampMs(entry.timestamp)}
                      </td>
                      <td>
                        <span class={walletHistoryCategoryClass(entry.category)}>
                          {walletHistoryCategoryLabel(entry.category)}
                        </span>
                      </td>
                      <td class="table-cell-ellipsis" title={entry.title}>
                        {entry.title}
                      </td>
                      <td class="text-mono">
                        {entry.amount != null
                          ? `${entry.amount.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} ${entry.asset}`
                          : '—'}
                      </td>
                      <td class="text-mono">
                        {entry.price != null ? entry.price.toFixed(4) : '—'}
                      </td>
                      <td>
                        <Show
                          when={entry.explorerUrl}
                          fallback={<span class="text-muted">—</span>}
                        >
                          <a
                            href={entry.explorerUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-mono table-cell-date"
                          >
                            Voir
                          </a>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </div>
  );
}
