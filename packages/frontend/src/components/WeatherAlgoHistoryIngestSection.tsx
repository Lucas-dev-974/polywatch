import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import {
  deleteWeatherHistoryInterval,
  fetchWeatherHistoryCities,
  fetchWeatherHistoryCoverage,
  fetchWeatherHistoryJob,
  startWeatherHistoryIngest,
  type WeatherHistoryCoverage,
  type WeatherHistoryIngestJob,
} from '../api';
import { CollapsibleSection } from './CollapsibleSection';
import { FIDELITY_OPTIONS } from '../lib/fidelity-options';

export interface WeatherAlgoHistoryIngestSectionProps {
  /** Extra city names from live discovery (merged with API list). */
  discoverCities?: string[];
}

type PeriodPreset = 'yesterday' | '7d' | '30d' | 'custom';

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'yesterday', label: 'Hier' },
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: 'custom', label: 'Personnalisé' },
];

function utcDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolvePeriod(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (preset === 'yesterday') {
    const y = new Date(today);
    y.setUTCDate(y.getUTCDate() - 1);
    const iso = utcDateIso(y);
    return { from: iso, to: iso };
  }
  if (preset === '7d') {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: utcDateIso(from), to: utcDateIso(today) };
  }
  if (preset === '30d') {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: utcDateIso(from), to: utcDateIso(today) };
  }
  return { from: customFrom, to: customTo };
}

interface CityRowState {
  period: PeriodPreset;
  customFrom: string;
  customTo: string;
  fidelityMinutes: number;
  loading: boolean;
  deleting: boolean;
  error: string | null;
  job: WeatherHistoryIngestJob | null;
  coverage: WeatherHistoryCoverage | null;
}

function defaultCustomFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return utcDateIso(d);
}

function defaultCustomTo(): string {
  return utcDateIso(new Date());
}

export function WeatherAlgoHistoryIngestSection(props: WeatherAlgoHistoryIngestSectionProps) {
  const [cities, setCities] = createSignal<string[]>([]);
  const [citiesLoading, setCitiesLoading] = createSignal(true);
  const [rowState, setRowState] = createSignal<Record<string, CityRowState>>({});
  // Active poll cancellation tokens keyed by city (lowercased). Flipped on
  // unmount so in-flight pollJob loops stop before touching setState.
  const pollTokens = new Map<string, { cancelled: boolean }>();

  onCleanup(() => {
    for (const token of pollTokens.values()) token.cancelled = true;
    pollTokens.clear();
  });

  async function loadCities() {
    setCitiesLoading(true);
    try {
      const apiCities = await fetchWeatherHistoryCities();
      const merged = new Map<string, string>();
      for (const c of apiCities) {
        const key = c.trim().toLowerCase();
        if (key) merged.set(key, c.trim());
      }
      for (const c of props.discoverCities ?? []) {
        const trimmed = c.trim();
        const key = trimmed.toLowerCase();
        if (key && !merged.has(key)) merged.set(key, trimmed);
      }
      const list = Array.from(merged.values()).sort((a, b) => a.localeCompare(b));
      setCities(list);
      setRowState((prev) => {
        const next = { ...prev };
        for (const city of list) {
          const key = city.toLowerCase();
          if (!next[key]) {
            next[key] = {
              period: '7d',
              customFrom: defaultCustomFrom(),
              customTo: defaultCustomTo(),
              fidelityMinutes: 60,
              loading: false,
              deleting: false,
              error: null,
              job: null,
              coverage: null,
            };
          }
        }
        return next;
      });
    } finally {
      setCitiesLoading(false);
    }
  }

  createEffect(() => {
    void loadCities();
  });

  createEffect(() => {
    const list = cities();
    for (const city of list) {
      void loadCoverage(city);
    }
  });

  async function loadCoverage(city: string) {
    const key = city.toLowerCase();
    try {
      const coverage = await fetchWeatherHistoryCoverage(city);
      setRowState((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? emptyRow()), coverage },
      }));
    } catch {
      /* ignore coverage errors */
    }
  }

  function emptyRow(): CityRowState {
    return {
      period: '7d',
      customFrom: defaultCustomFrom(),
      customTo: defaultCustomTo(),
      fidelityMinutes: 60,
      loading: false,
      deleting: false,
      error: null,
      job: null,
      coverage: null,
    };
  }

  function patchRow(city: string, patch: Partial<CityRowState>) {
    const key = city.toLowerCase();
    setRowState((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyRow()), ...patch },
    }));
  }

  async function pollJob(city: string, jobId: number) {
    const token = { cancelled: false };
    pollTokens.set(city.toLowerCase(), token);
    const startedAt = Date.now();
    const MAX_POLL_MS = 30 * 60 * 1000; // 30 min
    try {
      while (!token.cancelled) {
        const job = await fetchWeatherHistoryJob(jobId);
        if (token.cancelled) break;
        patchRow(city, { job });
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
          patchRow(city, {
            loading: false,
            error: job.status === 'error' ? (job.errorMessage ?? 'Erreur inconnue') : null,
          });
          void loadCoverage(city);
          break;
        }
        if (Date.now() - startedAt > MAX_POLL_MS) {
          patchRow(city, {
            loading: false,
            error: 'Délai d’attente dépassé (30 min) — vérifiez l’état du job côté serveur',
          });
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } finally {
      pollTokens.delete(city.toLowerCase());
    }
  }

  async function handleLoad(city: string) {
    const key = city.toLowerCase();
    const row = rowState()[key] ?? emptyRow();
    const { from, to } = resolvePeriod(row.period, row.customFrom, row.customTo);
    if (!from || !to) {
      patchRow(city, { error: 'Période invalide' });
      return;
    }

    patchRow(city, { loading: true, error: null, job: null });
    try {
      const { jobId, job } = await startWeatherHistoryIngest({
        city,
        from,
        to,
        fidelityMinutes: row.fidelityMinutes,
      });
      patchRow(city, { job });
      void pollJob(city, jobId);
    } catch (err) {
      patchRow(city, {
        loading: false,
        error: err instanceof Error ? err.message : 'Échec du chargement',
      });
    }
  }

  function formatCoverage(coverage: WeatherHistoryCoverage | null): string {
    if (!coverage || coverage.pointCount === 0) return 'Aucune donnée en base';
    const dates =
      coverage.targetDates.length > 0
        ? coverage.targetDates.join(', ')
        : '—';
    return `${coverage.pointCount.toLocaleString()} points · dates: ${dates}`;
  }

  function formatFidelityLabel(minutes: number): string {
    if (minutes >= 1440) return `${minutes / 1440} j`;
    if (minutes >= 60) return minutes === 60 ? '1 h' : `${minutes / 60} h`;
    return `${minutes} min`;
  }

  async function handleDeleteInterval(city: string, fidelityMinutes: number) {
    const key = city.toLowerCase();
    const row = rowState()[key] ?? emptyRow();
    if (
      !confirm(
        `Supprimer toutes les données de ${city} à l'intervalle ${formatFidelityLabel(fidelityMinutes)} ?\n\n` +
          'Cette action est irréversible.',
      )
    ) {
      return;
    }
    patchRow(city, { deleting: true, error: null });
    try {
      await deleteWeatherHistoryInterval(city, fidelityMinutes);
    } catch (err) {
      patchRow(city, {
        deleting: false,
        error: err instanceof Error ? err.message : 'Échec de la suppression',
      });
      return;
    }
    try {
      await loadCoverage(city);
    } catch {
      patchRow(city, {
        deleting: false,
        error: 'Supprimé — refresh coverage échoué',
      });
      return;
    }
    patchRow(city, { deleting: false });
  }

  function jobStatusLabel(job: WeatherHistoryIngestJob | null): string | null {
    if (!job) return null;
    if (job.status === 'pending' || job.status === 'running') {
      return `${job.marketsDone}/${job.marketsTotal} marchés · ${job.pointsUpserted.toLocaleString()} points`;
    }
    if (job.status === 'done') {
      const empty =
        job.marketsEmpty > 0 ? ` · ${job.marketsEmpty} sans données` : '';
      return `Terminé · ${job.pointsUpserted.toLocaleString()} points${empty}`;
    }
    if (job.status === 'error') {
      return job.errorMessage ?? 'Erreur';
    }
    return job.status;
  }

  return (
    <CollapsibleSection
      title="Données télécharger"
      persistKey="polywatch_weather_history_ingest_collapsed"
      class="weather-history-ingest"
    >
      <p class="form-hint weather-autotrack-note">
        Télécharge l&apos;historique CLOB Polymarket (série de prix YES/NO par bucket) via
        /prices-history (startTs/endTs) et l&apos;enregistre en base pour une ville et une période.
        Température max uniquement. Les données déjà présentes sont mises à jour sans doublon.
      </p>

      <Show when={citiesLoading()}>
        <p class="form-hint">Chargement des villes…</p>
      </Show>

      <Show when={!citiesLoading() && cities().length === 0}>
        <div class="weather-watched-empty">
          <p class="weather-watched-empty-title">Aucune ville connue</p>
          <p class="weather-watched-empty-text">
            Surveillez une ville ou explorez l&apos;onglet Marchés pour découvrir des villes.
          </p>
        </div>
      </Show>

      <Show when={!citiesLoading() && cities().length > 0}>
        <div class="weather-history-ingest-cards" role="region" aria-label="Données télécharger">
          <For each={cities()}>
            {(city) => {
              const row = () => rowState()[city.toLowerCase()] ?? emptyRow();
              const hasCoverage = () =>
                row().coverage != null && row().coverage!.pointCount > 0;
              return (
                <article
                  class="weather-history-ingest-card"
                  classList={{ 'weather-history-ingest-card--empty': !hasCoverage() }}
                >
                  <div class="weather-history-ingest-card__header">
                    <div class="weather-history-ingest-card__heading">
                      <span class="weather-history-ingest-card__city">{city}</span>
                      <Show
                        when={hasCoverage()}
                        fallback={
                          <span class="weather-history-ingest-card__points weather-history-ingest-card__points--empty">
                            Aucune donnée
                          </span>
                        }
                      >
                        <span class="weather-history-ingest-card__points">
                          {row().coverage!.pointCount.toLocaleString()}
                          <span class="weather-history-ingest-card__points-unit">points</span>
                        </span>
                      </Show>
                    </div>
                    <Show when={hasCoverage() && (row().coverage!.fromRecordedAt || row().coverage!.toRecordedAt)}>
                      <span class="weather-history-ingest-card__range">
                        {(() => {
                          const cov = row().coverage!;
                          const from = cov.fromRecordedAt
                            ? new Date(cov.fromRecordedAt).toLocaleDateString()
                            : '—';
                          const to = cov.toRecordedAt
                            ? new Date(cov.toRecordedAt).toLocaleDateString()
                            : '—';
                          return `${from} → ${to}`;
                        })()}
                      </span>
                    </Show>
                  </div>

                  <div class="weather-history-ingest-card__body">
                    <div class="weather-history-ingest-card__field">
                      <span class="weather-history-ingest-card__label">Période</span>
                      <div class="weather-history-ingest-period">
                        <select
                          value={row().period}
                          onChange={(e) =>
                            patchRow(city, {
                              period: e.currentTarget.value as PeriodPreset,
                            })
                          }
                        >
                          <For each={PERIOD_OPTIONS}>
                            {(opt) => <option value={opt.value}>{opt.label}</option>}
                          </For>
                        </select>
                        <Show when={row().period === 'custom'}>
                          <input
                            type="date"
                            value={row().customFrom}
                            onInput={(e) =>
                              patchRow(city, { customFrom: e.currentTarget.value })
                            }
                          />
                          <span>→</span>
                          <input
                            type="date"
                            value={row().customTo}
                            onInput={(e) =>
                              patchRow(city, { customTo: e.currentTarget.value })
                            }
                          />
                        </Show>
                      </div>
                    </div>

                    <div class="weather-history-ingest-card__field">
                      <span class="weather-history-ingest-card__label">Intervalle</span>
                      <select
                        value={String(row().fidelityMinutes)}
                        onChange={(e) =>
                          patchRow(city, {
                            fidelityMinutes: Number(e.currentTarget.value),
                          })
                        }
                      >
                        <For each={FIDELITY_OPTIONS}>
                          {(opt) => (
                            <option value={opt.value}>{opt.label}</option>
                          )}
                        </For>
                      </select>
                    </div>

                    <div class="weather-history-ingest-card__field">
                      <span class="weather-history-ingest-card__label">En base</span>
                      <Show
                        when={hasCoverage()}
                        fallback={<span class="weather-history-ingest-card__no-data">{formatCoverage(row().coverage)}</span>}
                      >
                        <div class="weather-history-ingest-coverage-card">
                          <Show when={row().coverage!.intervals.length > 0}>
                            <div class="weather-history-ingest-intervals">
                              <For each={row().coverage!.intervals}>
                                {(iv) => (
                                  <span class="weather-history-ingest-interval-badge">
                                    <span class="weather-history-ingest-interval-label">
                                      {formatFidelityLabel(iv.fidelityMinutes)}
                                    </span>
                                    <span class="weather-history-ingest-interval-count">
                                      {iv.pointCount.toLocaleString()}
                                    </span>
                                    <button
                                      type="button"
                                      class="weather-history-ingest-interval-remove"
                                      title={`Supprimer l'intervalle ${formatFidelityLabel(iv.fidelityMinutes)}`}
                                      disabled={row().deleting || row().loading}
                                      onClick={() =>
                                        void handleDeleteInterval(city, iv.fidelityMinutes)
                                      }
                                    >
                                      ×
                                    </button>
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                          <Show when={row().coverage!.targetDates.length > 0}>
                            <div class="weather-history-ingest-dates">
                              <For each={row().coverage!.targetDates}>
                                {(d) => <span class="weather-history-ingest-date-chip">{d}</span>}
                              </For>
                            </div>
                          </Show>
                        </div>
                      </Show>
                      <Show when={row().job}>
                        {(job) => (
                          <span class="weather-history-ingest-status">{jobStatusLabel(job())}</span>
                        )}
                      </Show>
                      <Show when={row().error}>
                        <span class="weather-history-ingest-error">{row().error}</span>
                      </Show>
                    </div>
                  </div>

                  <div class="weather-history-ingest-card__footer">
                    <button
                      type="button"
                      class="btn btn-sm btn-primary weather-history-ingest-card__load"
                      disabled={row().loading}
                      onClick={() => void handleLoad(city)}
                    >
                      {row().loading ? 'Chargement…' : 'Charger'}
                    </button>
                  </div>
                </article>
              );
            }}
          </For>
        </div>
      </Show>
    </CollapsibleSection>
  );
}
