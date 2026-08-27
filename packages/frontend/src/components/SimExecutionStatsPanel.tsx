import { Show } from 'solid-js';
import type { SimExecutionStats } from './settings/sim-execution-settings-types';

function formatMs(value: number | null | undefined): string {
  return value != null ? `${value} ms` : '—';
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} %`;
}

function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div class="trader-profile-kpi">
      <span class="trader-profile-kpi-label">{props.label}</span>
      <span class="trader-profile-kpi-value mono">{props.value}</span>
      <Show when={props.hint}>
        {(hint) => <span class="form-hint">{hint()}</span>}
      </Show>
    </div>
  );
}

interface Props {
  stats: SimExecutionStats | null;
  loading?: boolean;
  error?: string | null;
  lastUpdatedAt?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function SimExecutionStatsPanel(props: Props) {
  const updatedLabel = () => {
    const ts = props.lastUpdatedAt;
    if (ts == null) return null;
    return new Date(ts).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <section class="settings-section settings-section-full sim-exec-stats-panel">
      <div class="sim-exec-stats-header">
        <div>
          <h3 class="settings-section-title">Statistiques live</h3>
          <p class="form-hint">
            Mesures issues des ordres réels (RTT CLOB et comparaisons shadow).
          </p>
        </div>
        <Show when={props.onRefresh}>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={props.refreshing || props.loading}
            onClick={() => props.onRefresh?.()}
          >
            {props.refreshing ? 'Actualisation…' : 'Actualiser'}
          </button>
        </Show>
      </div>

      <Show when={props.loading && !props.stats}>
        <div class="empty-state">Chargement des statistiques…</div>
      </Show>

      <Show when={props.error}>
        {(msg) => <p class="form-error">{msg()}</p>}
      </Show>

      <Show when={props.stats}>
        {(st) => (
          <>
            <div class="sim-exec-stats-status">
              <span
                class={`badge ${st().sufficientForCalibration ? 'sim' : 'warning'}`}
              >
                {st().sufficientForCalibration
                  ? 'Calibration RTT disponible'
                  : 'Données RTT insuffisantes (min. 10)'}
              </span>
              <Show when={updatedLabel()}>
                {(label) => (
                  <span class="form-hint">Mis à jour à {label()}</span>
                )}
              </Show>
            </div>

            <div class="trader-profile-kpis">
              <StatCard
                label="Échantillons RTT"
                value={String(st().latencySampleCount)}
                hint="Ordres réels mesurés"
              />
              <StatCard
                label="Latence p50"
                value={formatMs(st().latencyP50Ms)}
              />
              <StatCard
                label="Latence p90"
                value={formatMs(st().latencyP90Ms)}
              />
              <StatCard
                label="Comparaisons shadow"
                value={String(st().shadowFillCount)}
                hint="Fills réels vs FAK local"
              />
              <StatCard
                label="Écart prix moy."
                value={formatPct(st().shadowAvgPriceDeltaPct)}
              />
              <StatCard
                label="Écart qty moy."
                value={formatPct(st().shadowAvgQtyDeltaPct)}
              />
            </div>
          </>
        )}
      </Show>
    </section>
  );
}

/** One-line summary for SimHero. */
export function formatSimExecutionStatsSummary(
  stats: SimExecutionStats,
): string {
  const parts: string[] = [];
  parts.push(`${stats.latencySampleCount} RTT`);
  if (stats.latencyP50Ms != null) {
    parts.push(`p50 ${stats.latencyP50Ms} ms`);
  }
  if (stats.shadowFillCount > 0) {
    parts.push(`${stats.shadowFillCount} shadow`);
  }
  return parts.join(' · ');
}
