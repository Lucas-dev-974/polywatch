import { createSignal, For, Show } from 'solid-js';
import type {
  TraderFundingAnalysis,
  TraderFundingUnavailableReason,
} from '../lib/trader-insight';
import { PolygonscanSettingsDialog } from './PolygonscanSettingsDialog';
import { TraderFundingTimelineChart } from './TraderFundingTimelineChart';

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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function unavailableMessage(reason: TraderFundingUnavailableReason | undefined): string {
  switch (reason) {
    case 'invalid_api_key':
      return 'Clé API Polygonscan invalide — vérifiez la clé dans Configurer Polygonscan.';
    case 'rate_limit':
      return 'Limite de requêtes Polygonscan atteinte — réessayez dans une minute.';
    case 'polygonscan_error':
      return 'Analyse on-chain temporairement indisponible (erreur Polygonscan).';
    case 'missing_api_key':
    default:
      return 'Analyse on-chain indisponible — configurez votre clé API Polygonscan.';
  }
}

interface Props {
  funding: TraderFundingAnalysis | null;
  fundingUnavailableReason?: TraderFundingUnavailableReason;
  onRefresh?: () => void | Promise<void>;
}

export function TraderFundingSection(props: Props) {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);

  async function handleRefresh() {
    if (!props.onRefresh || refreshing()) return;
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PolygonscanSettingsDialog
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
        onSaved={props.onRefresh}
      />
      <section class="panel">
        <div class="panel-header">
          <h2>Flux wallet on-chain</h2>
          <div class="panel-header-actions">
            <Show when={props.funding}>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={refreshing()}
                onClick={() => void handleRefresh()}
              >
                {refreshing() ? 'Actualisation…' : 'Actualiser on-chain'}
              </button>
            </Show>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => setSettingsOpen(true)}
            >
              Configurer Polygonscan
            </button>
            <Show when={props.funding}>
              <span class="panel-count">USDC / pUSD · Polygon</span>
            </Show>
          </div>
        </div>

        <Show
          when={props.funding}
          fallback={
            <div class="panel-body">
              <p class="form-hint">{unavailableMessage(props.fundingUnavailableReason)}</p>
              <Show
                when={
                  props.fundingUnavailableReason === 'missing_api_key' ||
                  props.fundingUnavailableReason === 'invalid_api_key'
                }
              >
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  style={{ 'margin-top': '0.5rem' }}
                  onClick={() => setSettingsOpen(true)}
                >
                  Configurer la clé API
                </button>
              </Show>
              <p class="form-hint trader-profile-meta">
                Estimation basée sur les transferts ERC-20 externes (hors contrats
                Polymarket). Exclut les dépôts cross-chain avant arrivée USDC sur Polygon.
              </p>
            </div>
          }
        >
          {(funding) => (
            <>
              <Show when={funding().truncated || funding().coverage.partialFetch}>
                <div class="panel-body">
                  <p class="form-hint">
                    <Show when={funding().coverage.partialFetch}>
                      Récupération partielle —{' '}
                      {funding().coverage.fetchesCompleted}/{funding().coverage.fetchesTotal}{' '}
                      sources Polygonscan consultées avec succès.
                      {' '}
                    </Show>
                    <Show when={funding().truncated}>
                      Historique possiblement tronqué (plafond ~100 000 tx par token/adresse
                      ou limite API). Les totaux peuvent être sous-estimés.
                    </Show>
                    {' '}
                    Utilisez « Actualiser on-chain » pour relancer une récupération complète.
                  </p>
                </div>
              </Show>

              <div class="panel-body trader-profile-kpis">
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Total déposé</span>
                  <span class="trader-profile-kpi-value">
                    {formatUsd(funding().summary.totalDepositedUsdc)}
                  </span>
                </div>
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Total retiré</span>
                  <span class="trader-profile-kpi-value">
                    {formatUsd(funding().summary.totalWithdrawnUsdc)}
                  </span>
                </div>
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Net injecté</span>
                  <span class="trader-profile-kpi-value">
                    {formatUsd(funding().summary.netDepositedUsdc)}
                  </span>
                </div>
                <div class="trader-profile-kpi">
                  <span class="trader-profile-kpi-label">Nb dépôts</span>
                  <span class="trader-profile-kpi-value">
                    {funding().summary.depositCount}
                  </span>
                </div>
              </div>

              <div class="panel-body">
                <p class="form-hint trader-profile-meta">
                  Premier dépôt : {formatDate(funding().summary.firstDepositAt)}
                  {' · '}
                  Dernier dépôt : {formatDate(funding().summary.lastDepositAt)}
                  {' · '}
                  {funding().coverage.classifiedTransferCount} flux externes classés
                  ({funding().coverage.rawTransferCount} transferts ERC-20 bruts lus)
                </p>
              </div>

              <div class="panel-body">
                <TraderFundingTimelineChart
                  points={funding().timeline}
                  hint="Flux externes uniquement (bridge, CEX, wallet). Transferts internes Polymarket exclus."
                />
              </div>

              <div class="panel-header">
                <h3>Derniers transferts</h3>
                <span class="panel-count">
                  {funding().recentTransfers.length} affichés
                  {' · '}
                  {funding().coverage.classifiedTransferCount} au total
                </span>
              </div>
              <div class="panel-body-flush">
                <Show
                  when={funding().recentTransfers.length > 0}
                  fallback={
                    <div class="panel-body empty-state">
                      <div class="empty-state-icon">◎</div>
                      Aucun transfert externe détecté
                    </div>
                  }
                >
                  <div class="table-wrap">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Direction</th>
                          <th>Token</th>
                          <th>Montant</th>
                          <th>Contrepartie</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        <For each={funding().recentTransfers}>
                          {(row) => (
                            <tr>
                              <td class="muted">{formatDateTime(row.timestamp)}</td>
                              <td>
                                <span
                                  class={`badge ${row.direction === 'deposit' ? 'success' : 'warning'}`}
                                >
                                  {row.direction === 'deposit' ? 'Dépôt' : 'Retrait'}
                                </span>
                              </td>
                              <td>{row.token}</td>
                              <td>{formatUsd(row.amountUsdc)}</td>
                              <td class="muted" title={row.counterparty}>
                                {shortAddress(row.counterparty)}
                              </td>
                              <td style={{ 'text-align': 'right' }}>
                                <a
                                  class="btn btn-ghost btn-sm"
                                  href={row.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Tx ↗
                                </a>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </div>

              <div class="panel-body">
                <p class="form-hint trader-profile-meta">
                  Adresses analysées : {funding().addressesAnalyzed.length}
                  {' · '}
                  Seuls les dépôts/retraits externes comptent (pas les flux vers l&apos;exchange
                  Polymarket). Les gains réinvestis ne sont pas des nouveaux dépôts.
                </p>
              </div>
            </>
          )}
        </Show>
      </section>
    </>
  );
}
