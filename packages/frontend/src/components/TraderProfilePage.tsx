import { createSignal, For, onMount, Show } from 'solid-js';
import { useCopyFeedback } from '../hooks/useCopyFeedback';
import { formatPnlAmount, pnlClass } from '../lib/position';
import {
  fetchTraderInsight,
  polymarketProfileUrl,
  regularityBadgeClass,
  regularityLabelFr,
  type LeaderboardEntryContext,
  type TraderInsightResponse,
} from '../lib/trader-insight';
import { useWatchlistStore } from '../stores/watchlistStore';
import { TraderActivityTimelineChart } from './TraderActivityTimelineChart';
import { TraderCapitalEvolutionChart } from './TraderCapitalEvolutionChart';
import { TraderFundingSection } from './TraderFundingSection';
import { TraderMarketBreakdownChart } from './TraderMarketBreakdownChart';

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatDate(ts: number | null): string {
  if (ts == null) return '—';
  return new Date(ts * 1000).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  entry: LeaderboardEntryContext;
  onBack: () => void;
  onOpenSimAnalytics?: () => void;
}

export function TraderProfilePage(props: Props) {
  const watchlist = useWatchlistStore();
  const copyFeedback = useCopyFeedback<string>();
  const [insight, setInsight] = createSignal<TraderInsightResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [following, setFollowing] = createSignal(false);

  function isFollowed(): boolean {
    const normalized = props.entry.proxyWallet.toLowerCase();
    return watchlist.entries().some(
      (w) => w.traderAddress.toLowerCase() === normalized,
    );
  }

  async function loadInsight(options: { refreshFunding?: boolean } = {}) {
    setLoading(true);
    setError(null);
    try {
      setInsight(await fetchTraderInsight(props.entry, options));
    } catch (e) {
      setError((e as Error).message);
      setInsight(null);
    } finally {
      setLoading(false);
    }
  }

  async function refreshFunding() {
    setError(null);
    try {
      setInsight(await fetchTraderInsight(props.entry, { refreshFunding: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  onMount(async () => {
    await watchlist.load();
    await loadInsight();
  });

  async function follow() {
    if (isFollowed()) return;
    setFollowing(true);
    try {
      await watchlist.add(props.entry.proxyWallet);
      await loadInsight();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFollowing(false);
    }
  }

  const displayName = () =>
    props.entry.userName ||
    insight()?.profile.userName ||
    `${props.entry.proxyWallet.slice(0, 10)}…`;

  return (
    <div class="trader-profile">
      <div class="trader-profile-toolbar">
        <button class="btn btn-ghost btn-sm" type="button" onClick={props.onBack}>
          ← Retour au leaderboard
        </button>
      </div>

      <Show when={error()}>
        <div class="panel">
          <div class="panel-body">
            <p class="error">{error()}</p>
            <button class="btn btn-secondary btn-sm" type="button" onClick={() => void loadInsight()}>
              Réessayer
            </button>
          </div>
        </div>
      </Show>

      <Show
        when={!loading() && insight()}
        fallback={
          <div class="panel">
            <div class="panel-body empty-state">
              <div class="empty-state-icon">…</div>
              Chargement du profil trader…
            </div>
          </div>
        }
      >
        {(data) => (
          <>
            <section class="panel trader-profile-hero">
              <div class="panel-body">
                <div class="trader-profile-header">
                  <Show when={data().profile.profileImage || props.entry.profileImage}>
                    <img
                      class="leaderboard-avatar trader-profile-avatar"
                      src={data().profile.profileImage || props.entry.profileImage}
                      alt=""
                    />
                  </Show>
                  <div class="trader-profile-identity">
                    <h2 class="trader-profile-name">
                      {displayName()}
                      <Show when={data().profile.verifiedBadge || props.entry.verifiedBadge}>
                        <span class="badge success" style={{ 'margin-left': '0.375rem' }}>
                          ✓
                        </span>
                      </Show>
                    </h2>
                    <Show when={data().profile.xUsername || props.entry.xUsername}>
                      <p class="trader-profile-x">
                        @{data().profile.xUsername || props.entry.xUsername}
                      </p>
                    </Show>
                    <button
                      type="button"
                      class="trader-profile-address btn btn-ghost btn-sm"
                      onClick={() => void copyFeedback.copy(props.entry.proxyWallet, props.entry.proxyWallet)}
                    >
                      {props.entry.proxyWallet}
                      {copyFeedback.isCopied(props.entry.proxyWallet) ? ' · Copié' : ''}
                    </button>
                    <Show when={data().profile.bio}>
                      <p class="trader-profile-bio">{data().profile.bio}</p>
                    </Show>
                  </div>
                  <div class="trader-profile-actions">
                    <Show
                      when={isFollowed()}
                      fallback={
                        <button
                          class="btn btn-secondary btn-sm"
                          type="button"
                          disabled={following()}
                          onClick={() => void follow()}
                        >
                          {following() ? '…' : 'Suivre'}
                        </button>
                      }
                    >
                      <span class="badge neutral">Suivi</span>
                    </Show>
                    <a
                      class="btn btn-ghost btn-sm"
                      href={polymarketProfileUrl(props.entry.proxyWallet)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Voir sur Polymarket ↗
                    </a>
                  </div>
                </div>

                <div class="trader-profile-metrics">
                  <Show when={data().leaderboard?.rank}>
                    <div class="trader-profile-metric">
                      <span class="trader-profile-metric-label">Rang</span>
                      <span class="trader-profile-metric-value">#{data().leaderboard!.rank}</span>
                    </div>
                  </Show>
                  <Show when={data().leaderboard?.pnl != null}>
                    <div class="trader-profile-metric">
                      <span class="trader-profile-metric-label">PnL leaderboard</span>
                      <span
                        class={`trader-profile-metric-value ${pnlClass(data().leaderboard!.pnl!)}`}
                      >
                        {formatUsd(data().leaderboard!.pnl!)}
                      </span>
                    </div>
                  </Show>
                  <Show when={data().leaderboard?.vol != null}>
                    <div class="trader-profile-metric">
                      <span class="trader-profile-metric-label">Volume leaderboard</span>
                      <span class="trader-profile-metric-value">
                        {formatUsd(data().leaderboard!.vol!)}
                      </span>
                    </div>
                  </Show>
                  <Show when={data().portfolioValue != null}>
                    <div class="trader-profile-metric">
                      <span class="trader-profile-metric-label">Portefeuille</span>
                      <span class="trader-profile-metric-value">
                        {formatUsd(data().portfolioValue!)}
                      </span>
                    </div>
                  </Show>
                </div>
              </div>
            </section>

            <Show when={data().activityTruncated}>
              <div class="panel">
                <div class="panel-body">
                  <p class="form-hint">
                    Historique partiel — Polymarket limite l&apos;accès aux
                    ~3 500 trades les plus récents. Les métriques ci-dessous
                    portent sur cette fenêtre.
                  </p>
                </div>
              </div>
            </Show>

            <section class="panel">
              <div class="panel-header">
                <h2>Évolution du capital</h2>
                <Show when={data().portfolioValue != null}>
                  <span class="panel-count">
                    Actuel : {formatUsd(data().portfolioValue!)}
                  </span>
                </Show>
              </div>
              <div class="panel-body">
                <TraderCapitalEvolutionChart
                  points={data().capitalSeries}
                  hint={
                    data().activityTruncated
                      ? 'Courbe reconstruite sur les ~3 500 derniers trades, calibrée sur la valeur actuelle du portefeuille.'
                      : 'Courbe reconstruite à partir des trades et rachats, calibrée sur la valeur actuelle du portefeuille.'
                  }
                />
              </div>
            </section>

            <TraderFundingSection
              funding={data().funding}
              fundingUnavailableReason={data().fundingUnavailableReason}
              onRefresh={() => void refreshFunding()}
            />

            <section class="panel">
              <div class="panel-header">
                <h2>Activité</h2>
                <span
                  class={`badge ${regularityBadgeClass(data().activitySummary.regularityLabel)}`}
                >
                  {regularityLabelFr(data().activitySummary.regularityLabel)}
                  {' '}
                  · {data().activitySummary.regularityScore}%
                </span>
              </div>
              <div class="panel-body trader-profile-kpis">
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Trades</span>
                  <span class="trader-profile-kpi-value">
                    {data().activitySummary.totalTrades}
                  </span>
                </div>
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Volume total</span>
                  <span class="trader-profile-kpi-value">
                    {formatUsd(data().activitySummary.totalVolumeUsdc)}
                  </span>
                </div>
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Semaines actives</span>
                  <span class="trader-profile-kpi-value">
                    {data().activitySummary.activeWeeks}/{data().activitySummary.totalWeeks}
                  </span>
                </div>
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Trades / semaine</span>
                  <span class="trader-profile-kpi-value">
                    {data().activitySummary.avgTradesPerWeek}
                  </span>
                </div>
              </div>
              <div class="panel-body">
                <p class="form-hint trader-profile-meta">
                  Premier trade : {formatDate(data().activitySummary.firstActivityAt)}
                  {' · '}
                  Dernier trade : {formatDate(data().activitySummary.lastActivityAt)}
                  {' · '}
                  Plus long silence : {data().activitySummary.longestGapDays} j
                </p>
              </div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <h2>Régularité dans le temps</h2>
                <span class="panel-count">Trades par semaine</span>
              </div>
              <div class="panel-body">
                <TraderActivityTimelineChart points={data().activityTimeline} />
              </div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <h2>Types de marchés</h2>
                <span class="panel-count">Par volume</span>
              </div>
              <div class="panel-body">
                <TraderMarketBreakdownChart rows={data().marketBreakdown} />
              </div>
            </section>

            <Show when={data().watchlist}>
              <section class="panel trader-profile-polywatch">
                <div class="panel-header">
                  <h2>Votre suivi Polywatch</h2>
                  <span class="badge sim">Watchlist</span>
                </div>
                <div class="panel-body">
                  <Show
                    when={data().simStats}
                    fallback={
                      <p class="form-hint">
                        Ce trader est dans votre watchlist
                        {data().watchlist!.nickname
                          ? ` (${data().watchlist!.nickname})`
                          : ''}
                        . Aucune position sim copiée pour l&apos;instant.
                      </p>
                    }
                  >
                    {(stats) => (
                      <div class="trader-profile-kpis">
                        <div class="trader-profile-kpi">
                          <span class="trader-profile-kpi-label">Positions sim</span>
                          <span class="trader-profile-kpi-value">
                            {stats().positionCount}
                          </span>
                        </div>
                        <div class="trader-profile-kpi">
                          <span class="trader-profile-kpi-label">PnL sim copié</span>
                          <span class={`trader-profile-kpi-value ${pnlClass(stats().totalPnl)}`}>
                            {formatPnlAmount(stats().totalPnl, true)}
                          </span>
                        </div>
                        <div class="trader-profile-kpi">
                          <span class="trader-profile-kpi-label">Win rate</span>
                          <span class="trader-profile-kpi-value">
                            {stats().winRatePercent?.toFixed(1) ?? '—'}
                          </span>
                        </div>
                        <div class="trader-profile-kpi">
                          <span class="trader-profile-kpi-label">ROI sim</span>
                          <span class="trader-profile-kpi-value">
                            {stats().roiPercent?.toFixed(1) ?? '—'}
                          </span>
                        </div>
                      </div>
                    )}
                  </Show>
                  <Show when={props.onOpenSimAnalytics && data().simStats}>
                    <button
                      class="btn btn-secondary btn-sm"
                      type="button"
                      style={{ 'margin-top': '0.75rem' }}
                      onClick={props.onOpenSimAnalytics}
                    >
                      Voir dans Analytics sim
                    </button>
                  </Show>
                </div>
              </section>
            </Show>

            <section class="panel">
              <div class="panel-header">
                <h2>Positions ouvertes</h2>
                <span class="panel-count">{data().openPositions.length}</span>
              </div>
              <div class="panel-body-flush">
                <Show
                  when={data().openPositions.length > 0}
                  fallback={
                    <div class="panel-body empty-state">
                      <div class="empty-state-icon">◎</div>
                      Aucune position ouverte
                    </div>
                  }
                >
                  <div class="table-wrap">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Marché</th>
                          <th>Outcome</th>
                          <th>Taille</th>
                          <th>Prix moy.</th>
                          <th>Valeur</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={data().openPositions}>
                          {(pos) => (
                            <tr>
                              <td>{pos.title}</td>
                              <td>{pos.outcome}</td>
                              <td>{pos.size.toFixed(2)}</td>
                              <td>
                                {pos.avgPrice != null ? pos.avgPrice.toFixed(3) : '—'}
                              </td>
                              <td>
                                {pos.currentValue != null
                                  ? formatUsd(pos.currentValue)
                                  : '—'}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <h2>Activité récente</h2>
                <span class="panel-count">{data().recentActivity.length}</span>
              </div>
              <div class="panel-body-flush">
                <Show
                  when={data().recentActivity.length > 0}
                  fallback={
                    <div class="panel-body empty-state">
                      <div class="empty-state-icon">◎</div>
                      Aucune activité récente
                    </div>
                  }
                >
                  <div class="table-wrap">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Action</th>
                          <th>Montant</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        <For each={data().recentActivity}>
                          {(row) => (
                            <tr>
                              <td class="muted">{formatDateTime(row.timestamp)}</td>
                              <td>{row.title}</td>
                              <td>
                                {row.amount != null ? formatUsd(row.amount) : '—'}
                              </td>
                              <td style={{ 'text-align': 'right' }}>
                                <Show when={row.explorerUrl}>
                                  <a
                                    class="btn btn-ghost btn-sm"
                                    href={row.explorerUrl!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Tx ↗
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
            </section>
          </>
        )}
      </Show>
    </div>
  );
}
