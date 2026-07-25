import { createEffect, createSignal, For, Show } from 'solid-js';
import type { SimStateSnapshotDetail } from '../lib/simulation-snapshots';
import { formatShortDateTime } from '../lib/date';
import {
  closeReasonBadgeClass,
  formatPnlAmount,
  pnlClass,
} from '../lib/position';
import { Dialog } from './Dialog';
import {
  formatSnapshotConfigValue,
  groupSnapshotConfigEntries,
} from '../lib/snapshot-config-display';

type DetailTab = 'traders' | 'config' | 'positions' | 'executions' | 'decisions';

interface Props {
  open: boolean;
  onClose: () => void;
  detail: SimStateSnapshotDetail | null;
}

function traderWatchlistBadge(trader: SimStateSnapshotDetail['traders'][number]) {
  if (!trader.inWatchlistSim) return { class: 'warn', label: 'Orphelin' };
  if (trader.active) return { class: 'success', label: 'Actif' };
  return { class: 'neutral', label: 'Inactif' };
}

function sideBadgeClass(side: string): string {
  const s = side.toLowerCase();
  if (s === 'buy' || s === 'long') return 'success';
  if (s === 'sell' || s === 'short') return 'danger';
  return 'neutral';
}

export function SimSnapshotDetailDialog(props: Props) {
  const [tab, setTab] = createSignal<DetailTab>('traders');

  createEffect(() => {
    const id = props.detail?.id;
    if (props.open && id != null) {
      setTab('traders');
    }
  });

  const title = () => {
    const d = props.detail;
    if (!d) return 'Détail snapshot';
    const date = formatShortDateTime(d.createdAt);
    return d.label ? `${date} · ${d.label}` : date;
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={title()}
      titleId="sim-snapshot-detail-title"
      class="dialog-settings dialog-snapshot-detail"
      bodyClass="dialog-body-settings"
    >
      <Show when={props.detail} fallback={<div class="empty-state">Chargement…</div>}>
        {(detail) => (
          <>
            <div class="sim-snapshot-detail-summary stat-row">
              <div class="stat-card">
                <span class="stat-label">Equity</span>
                <span class="stat-value mono">
                  {formatPnlAmount(detail().equity)}{' '}
                  <span class="mode-hero-token">{detail().token}</span>
                </span>
              </div>
              <div class="stat-card">
                <span class="stat-label">PnL session</span>
                <span class={`stat-value mono ${pnlClass(detail().sessionPnl)}`}>
                  {formatPnlAmount(detail().sessionPnl, true)}
                </span>
              </div>
              <div class="stat-card">
                <span class="stat-label">Traders</span>
                <span class="stat-value">{detail().traderCount}</span>
              </div>
            </div>

            <div class="panel-tabs">
              <button
                type="button"
                class={`panel-tab ${tab() === 'traders' ? 'active' : ''}`}
                onClick={() => setTab('traders')}
              >
                Traders
              </button>
              <button
                type="button"
                class={`panel-tab ${tab() === 'config' ? 'active' : ''}`}
                onClick={() => setTab('config')}
              >
                Config
              </button>
              <button
                type="button"
                class={`panel-tab ${tab() === 'positions' ? 'active' : ''}`}
                onClick={() => setTab('positions')}
              >
                Positions
              </button>
              <button
                type="button"
                class={`panel-tab ${tab() === 'executions' ? 'active' : ''}`}
                onClick={() => setTab('executions')}
              >
                Exécutions
              </button>
              <button
                type="button"
                class={`panel-tab ${tab() === 'decisions' ? 'active' : ''}`}
                onClick={() => setTab('decisions')}
              >
                Décisions
              </button>
            </div>

            <Show when={tab() === 'traders'}>
              <div class="panel-scroll sim-snapshot-table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Trader</th>
                      <th>Watchlist sim</th>
                      <th>Pos.</th>
                      <th>PnL réalisé</th>
                      <th>PnL ouvert</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={detail().traders}>
                      {(t) => {
                        const badge = traderWatchlistBadge(t);
                        return (
                          <tr>
                            <td>
                              {t.nickname ?? `${t.traderAddress.slice(0, 12)}…`}
                            </td>
                            <td>
                              <span class={`badge badge-xs ${badge.class}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td>
                              {t.positionCount} ({t.openPositionCount}/
                              {t.closedPositionCount})
                            </td>
                            <td class={pnlClass(t.realizedPnl)}>
                              {formatPnlAmount(t.realizedPnl, true)}
                            </td>
                            <td class={pnlClass(t.unrealizedPnl)}>
                              {formatPnlAmount(t.unrealizedPnl, true)}
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>

            <Show when={tab() === 'config'}>
              <For each={groupSnapshotConfigEntries(detail().config as Record<string, unknown>)}>
                {(section) => (
                  <div class="sim-snapshot-config-section">
                    <div class="sim-snapshot-config-section-title">{section.title}</div>
                    <div class="sim-snapshot-config-grid">
                      <For each={section.entries}>
                        {([key, value]) => (
                          <div class="sim-snapshot-config-row">
                            <span class="sim-snapshot-config-key">{key}</span>
                            <span class="sim-snapshot-config-val">
                              {typeof value === 'boolean' ? (
                                <span
                                  class={`badge badge-xs ${value ? 'success' : 'neutral'}`}
                                >
                                  {value ? 'oui' : 'non'}
                                </span>
                              ) : (
                                formatSnapshotConfigValue(value)
                              )}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
              <Show when={'simAllowedMarketTags' in detail().config}>
                <div class="sim-snapshot-config-section">
                  <div class="sim-snapshot-config-grid">
                    <div class="sim-snapshot-config-row">
                      <span class="sim-snapshot-config-key">simAllowedMarketTags</span>
                      <span class="sim-snapshot-config-val">
                        {detail().config.simAllowedMarketTags.join(', ') || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </Show>
              <Show
                when={
                  'realAllowedMarketTags' in detail().config &&
                  Array.isArray(
                    (detail().config as Record<string, unknown>).realAllowedMarketTags,
                  )
                }
              >
                <div class="sim-snapshot-config-section">
                  <div class="sim-snapshot-config-grid">
                    <div class="sim-snapshot-config-row">
                      <span class="sim-snapshot-config-key">realAllowedMarketTags</span>
                      <span class="sim-snapshot-config-val">
                        {(
                          (detail().config as Record<string, unknown>)
                            .realAllowedMarketTags as string[]
                        ).join(', ') || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </Show>
            </Show>

            <Show when={tab() === 'positions'}>
              <div class="panel-scroll sim-snapshot-table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Marché</th>
                      <th>Trader</th>
                      <th>Statut</th>
                      <th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={detail().positions}>
                      {(p) => {
                        const pnl =
                          p.status === 'closed' ? p.realizedPnl : p.unrealizedPnl;
                        return (
                          <tr>
                            <td class="truncate-cell">
                              {p.marketQuestion ?? p.conditionId}
                            </td>
                            <td>{p.traderName ?? '—'}</td>
                            <td>
                              <span
                                class={`badge badge-xs ${p.status === 'open' ? 'sim' : 'neutral'}`}
                              >
                                {p.status}
                              </span>
                            </td>
                            <td class={pnlClass(pnl)}>
                              {formatPnlAmount(pnl, true)}
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>

            <Show when={tab() === 'executions'}>
              <div class="panel-scroll sim-snapshot-table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Side</th>
                      <th>Raison</th>
                      <th>Qty</th>
                      <th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={detail().executions}>
                      {(e) => (
                        <tr>
                          <td>{formatShortDateTime(e.executedAt)}</td>
                          <td>
                            <span class={`badge badge-xs ${sideBadgeClass(e.side)}`}>
                              {e.side}
                            </span>
                          </td>
                          <td>
                            {e.reason ? (
                              <span
                                class={`badge badge-xs ${closeReasonBadgeClass(e.reason)}`}
                              >
                                {e.reason}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>{e.fillQuantity ?? '—'}</td>
                          <td class={pnlClass(e.realizedPnl)}>
                            {formatPnlAmount(e.realizedPnl, true)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>

            <Show when={tab() === 'decisions'}>
              <Show
                when={detail().decisionSummary}
                fallback={
                  <div class="empty-state">
                    Journal décisionnel non disponible (snapshot antérieur à la
                    mise à jour).
                  </div>
                }
              >
                {(summary) => (
                  <div class="sim-snapshot-decisions">
                    <div class="stat-row">
                      <div class="stat-card">
                        <span class="stat-label">Fenêtre depuis</span>
                        <span class="stat-value mono">
                          {formatShortDateTime(summary().windowFrom)}
                        </span>
                      </div>
                      <div class="stat-card">
                        <span class="stat-label">Exit attempts</span>
                        <span class="stat-value">{summary().exitAttemptsTotal}</span>
                      </div>
                      <div class="stat-card">
                        <span class="stat-label">Move events</span>
                        <span class="stat-value">{summary().moveEventsTotal}</span>
                      </div>
                      <div class="stat-card">
                        <span class="stat-label">Moves skippés sim</span>
                        <span class="stat-value">{summary().moveEventsSkippedSim}</span>
                      </div>
                    </div>
                    <Show when={summary().truncated}>
                      <p class="text-muted text-sm">
                        Liste tronquée (limite de taille) — voir agrégats ci-dessus.
                      </p>
                    </Show>
                    <Show when={detail().exitAttempts.length > 0}>
                      <h4 class="sim-snapshot-section-title">Tentatives de sortie</h4>
                      <div class="panel-scroll sim-snapshot-table-wrap">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Kind</th>
                              <th>Close</th>
                              <th>Block / erreur</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={detail().exitAttempts}>
                              {(e) => (
                                <tr>
                                  <td>{formatShortDateTime(e.createdAt)}</td>
                                  <td>{e.kind}</td>
                                  <td>{e.closeReason}</td>
                                  <td>{e.blockReason ?? e.error ?? '—'}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </Show>
                    <Show when={detail().moveEvents.length > 0}>
                      <h4 class="sim-snapshot-section-title">Move events</h4>
                      <div class="panel-scroll sim-snapshot-table-wrap">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Trader</th>
                              <th>Skip sim</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={detail().moveEvents}>
                              {(m) => (
                                <tr>
                                  <td>{formatShortDateTime(m.detectedAt)}</td>
                                  <td>{m.eventType}</td>
                                  <td class="mono">{m.traderAddress.slice(0, 12)}…</td>
                                  <td>{m.skipReasonsSim ?? '—'}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </Show>
                  </div>
                )}
              </Show>
            </Show>
          </>
        )}
      </Show>
    </Dialog>
  );
}
