import { createSignal, For, onMount, Show } from 'solid-js';
import { api } from '../api';
import {
  LEADERBOARD_CATEGORY_OPTIONS,
  type LeaderboardApiCategory,
} from '../lib/leaderboard-categories';
import type { LeaderboardEntryContext } from '../lib/trader-insight';
import { useWatchlistStore } from '../stores/watchlistStore';
import { TraderProfilePage } from './TraderProfilePage';

type LeaderboardEntry = LeaderboardEntryContext;

type TimePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL';
type OrderBy = 'PNL' | 'VOL';

const PAGE_SIZE = 25;

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

interface Props {
  onOpenSimAnalytics?: () => void;
}

export function Leaderboard(props: Props) {
  const watchlist = useWatchlistStore();
  const [entries, setEntries] = createSignal<LeaderboardEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [following, setFollowing] = createSignal<string | null>(null);
  const [selectedTrader, setSelectedTrader] = createSignal<LeaderboardEntry | null>(
    null,
  );
  const [offset, setOffset] = createSignal(0);
  const [category, setCategory] = createSignal<LeaderboardApiCategory>('OVERALL');
  const [timePeriod, setTimePeriod] = createSignal<TimePeriod>('ALL');
  const [orderBy, setOrderBy] = createSignal<OrderBy>('PNL');

  function isFollowed(address: string): boolean {
    const normalized = address.toLowerCase();
    return watchlist.entries().some((w) => w.traderAddress.toLowerCase() === normalized);
  }

  async function loadLeaderboard() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        category: category(),
        timePeriod: timePeriod(),
        orderBy: orderBy(),
        limit: String(PAGE_SIZE),
        offset: String(offset()),
      });
      setEntries(await api<LeaderboardEntry[]>(`/leaderboard?${params}`));
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  onMount(async () => {
    await watchlist.load();
    await loadLeaderboard();
  });

  async function applyFilters() {
    setOffset(0);
    await loadLeaderboard();
  }

  async function follow(entry: LeaderboardEntry, event: MouseEvent) {
    event.stopPropagation();
    if (isFollowed(entry.proxyWallet)) return;
    setFollowing(entry.proxyWallet);
    try {
      await watchlist.add(entry.proxyWallet);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFollowing(null);
    }
  }

  async function goToPage(nextOffset: number) {
    setOffset(nextOffset);
    await loadLeaderboard();
  }

  return (
    <Show
      when={!selectedTrader()}
      fallback={
        <TraderProfilePage
          entry={selectedTrader()!}
          onBack={() => setSelectedTrader(null)}
          onOpenSimAnalytics={props.onOpenSimAnalytics}
        />
      }
    >
      <section class="panel">
        <div class="panel-header">
          <h2>Leaderboard Polymarket</h2>
          <span class="panel-count">Top traders</span>
        </div>

        <div class="panel-body">
          <div class="leaderboard-filters">
            <div class="form-field">
              <label>Catégorie</label>
              <select
                class="select"
                value={category()}
                onChange={(e) =>
                  setCategory(e.currentTarget.value as LeaderboardApiCategory)
                }
              >
                <For each={LEADERBOARD_CATEGORY_OPTIONS}>
                  {(option) => <option value={option.value}>{option.label}</option>}
                </For>
              </select>
            </div>
            <div class="form-field">
              <label>Période</label>
              <select
                class="select"
                value={timePeriod()}
                onChange={(e) => setTimePeriod(e.currentTarget.value as TimePeriod)}
              >
                <option value="ALL">Tout</option>
                <option value="MONTH">Mois</option>
                <option value="WEEK">Semaine</option>
                <option value="DAY">Jour</option>
              </select>
            </div>
            <div class="form-field">
              <label>Tri</label>
              <select
                class="select"
                value={orderBy()}
                onChange={(e) => setOrderBy(e.currentTarget.value as OrderBy)}
              >
                <option value="PNL">PnL</option>
                <option value="VOL">Volume</option>
              </select>
            </div>
            <button class="btn btn-primary" onClick={() => void applyFilters()}>
              Actualiser
            </button>
          </div>
        </div>

        <Show when={error()}>
          <div class="panel-body">
            <p class="error">{error()}</p>
          </div>
        </Show>

        <div class="panel-body-flush">
          <Show
            when={!loading()}
            fallback={
              <div class="empty-state">
                <div class="empty-state-icon">…</div>
                Chargement du leaderboard…
              </div>
            }
          >
            <Show
              when={entries().length > 0}
              fallback={
                <div class="empty-state">
                  <div class="empty-state-icon">◎</div>
                  Aucun trader trouvé
                </div>
              }
            >
              <div class="table-wrap">
                <table class="data-table leaderboard-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Trader</th>
                      <th>PnL</th>
                      <th>Volume</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <For each={entries()}>
                      {(entry) => (
                        <tr
                          class="leaderboard-row-clickable"
                          onClick={() => setSelectedTrader(entry)}
                        >
                          <td>{entry.rank}</td>
                          <td>
                            <div class="leaderboard-trader">
                              <Show when={entry.profileImage}>
                                <img
                                  class="leaderboard-avatar"
                                  src={entry.profileImage}
                                  alt=""
                                />
                              </Show>
                              <div>
                                <div class="trader-name">
                                  {entry.userName || entry.proxyWallet.slice(0, 10) + '…'}
                                  <Show when={entry.verifiedBadge}>
                                    <span
                                      class="badge success"
                                      style={{ 'margin-left': '0.375rem' }}
                                    >
                                      ✓
                                    </span>
                                  </Show>
                                </div>
                                <div class="trader-address">{entry.proxyWallet}</div>
                              </div>
                            </div>
                          </td>
                          <td
                            class={
                              entry.pnl >= 0
                                ? 'metric-value pnl-positive'
                                : 'metric-value pnl-negative'
                            }
                          >
                            {formatUsd(entry.pnl)}
                          </td>
                          <td>{formatUsd(entry.vol)}</td>
                          <td style={{ 'text-align': 'right' }}>
                            <Show
                              when={isFollowed(entry.proxyWallet)}
                              fallback={
                                <button
                                  class="btn btn-secondary btn-sm"
                                  disabled={following() === entry.proxyWallet}
                                  onClick={(e) => void follow(entry, e)}
                                >
                                  {following() === entry.proxyWallet ? '…' : 'Suivre'}
                                </button>
                              }
                            >
                              <span class="badge neutral">Suivi</span>
                            </Show>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>
        </div>

        <Show when={!loading() && entries().length > 0}>
          <div class="panel-body leaderboard-pagination">
            <button
              class="btn btn-secondary btn-sm"
              disabled={offset() === 0}
              onClick={() => void goToPage(Math.max(0, offset() - PAGE_SIZE))}
            >
              Précédent
            </button>
            <span class="muted">
              {offset() + 1}–{offset() + entries().length}
            </span>
            <button
              class="btn btn-secondary btn-sm"
              disabled={entries().length < PAGE_SIZE}
              onClick={() => void goToPage(offset() + PAGE_SIZE)}
            >
              Suivant
            </button>
          </div>
        </Show>
      </section>
    </Show>
  );
}
