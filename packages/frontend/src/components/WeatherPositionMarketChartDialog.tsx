import { createEffect, createSignal, Show } from 'solid-js';
import {
  fetchBucketTickTimeline,
  type BucketTimelineCity,
} from '../api';
import type { WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import { Dialog } from './Dialog';
import { SeriesChart, type SeriesChartMarker } from './WeatherTimelineView';
import { formatTimelineBucketLabel, formatBucketTargetLabel, toChartPoints } from '../lib/weather-position';
import { WeatherPositionChartSummary } from './weather-position-group/WeatherPositionChartSummary';

export interface WeatherPositionMarketChartDialogProps {
  position: WeatherPosition;
  onClose: () => void;
}

/**
 * Affiche le graph du marché (buckets de prix) d'une position weather, dans le
 * même style que le dialog "weather-bucket-dialog" de l'onglet Données.
 */
export function WeatherPositionMarketChartDialog(
  props: WeatherPositionMarketChartDialogProps,
) {
  const pos = () => props.position;
  const wf = () => pos().weatherForecast;

  const [city, setCity] = createSignal<BucketTimelineCity | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [minPrice, setMinPrice] = createSignal(0.2);

  const conditionId = () => pos().conditionId;
  const targetDateIso = () => wf()?.targetDate?.slice(0, 10) ?? '';

  // Borne la fenêtre temporelle pour garantir que toute l'agrégation pré-target
  // soit chargée. Les ticks d'une date cible s'enregistrent sur ~4 jours AVANT
  // la résolution (le marché cote bien avant). Ancrer `from` sur openedAt
  // tronquerait la période d'activité et masquerait le contexte de l'entrée.
  // On remonte donc 4 jours avant la date cible, et on borne `to` à la clôture
  // de la position (si fermée) ou au maintenant (si ouverte).
  const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
  function windowFromTo(): { from?: string; to?: string } {
    const p = pos();
    const out: { from?: string; to?: string } = {};
    // La date cible porte la résolution : on remonte 4 jours avant.
    const target = targetDateIso();
    if (target) {
      out.from = new Date(new Date(target).getTime() - FOUR_DAYS_MS).toISOString();
    } else if (p.openedAt) {
      out.from = new Date(new Date(p.openedAt).getTime() - FOUR_DAYS_MS).toISOString();
    }
    if (p.closedAt) {
      // Petite marge après la sortie pour que le marker ne colle pas au bord.
      out.to = new Date(new Date(p.closedAt).getTime() + 2 * 60_000).toISOString();
    }
    return out;
  }

  async function load() {
    if (!conditionId() || !targetDateIso()) {
      setError('Position sans conditionId ou date cible.');
      return;
    }
    setLoading(true);
    setError(null);
    setCity(null);
    try {
      const city = wf()?.city ?? undefined;
      const timeWindow = windowFromTo();
      const res = await fetchBucketTickTimeline(targetDateIso(), {
        // Affiche tous les buckets de la date cible / ville de la position.
        // On filtre par ville (et non par conditionId) pour ne pas réduire le
        // graph au seul bucket de la position. Fallback conditionId si la
        // position n'a pas de ville renseignée.
        city,
        conditionId: city ? undefined : conditionId(),
        from: timeWindow.from,
        to: timeWindow.to,
        // maxTicks est ignoré par le backend quand from/to est fourni (tous les
        // points de la fenêtre sont retournés). On ne filtre PAS par
        // fidelityMinutes : la cadence de la position (ouverte il y a
        // potentiellement longtemps) peut différer de la cadence actuelle
        // (weatherAlgoPollMs). Filtrer à la cadence actuelle exclurait les
        // ticks de la période d'entrée.
        fidelityMinutes: undefined,
      });
      const match = res.dates[0]?.cities?.[0];
      if (!match || match.buckets.length === 0) {
        setError('Aucun tick enregistré pour ce marché.');
        return;
      }
      setCity(match);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Timeline indisponible');
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    if (props.position) void load();
  });

  const buckets = () =>
    (city()?.buckets ?? []).map((b) => ({
      label: formatBucketTargetLabel(b),
      fullLabel: formatTimelineBucketLabel(b),
      series: toChartPoints(b.series),
    }));

  const markers = (): SeriesChartMarker[] => {
    const list: SeriesChartMarker[] = [];
    const p = pos();
    if (p.openedAt != null) {
      list.push({
        t: new Date(p.openedAt).getTime(),
        y: p.entryPrice,
        label: 'Entrée',
        kind: 'entry',
      });
    }
    if (p.closedAt != null && p.exitBidVwap != null) {
      list.push({
        t: new Date(p.closedAt).getTime(),
        y: p.exitBidVwap,
        label: 'Sortie',
        kind: 'exit',
      });
    }
    return list;
  };

  return (
    <Dialog
      open
      onClose={props.onClose}
      title={`${wf()?.city ?? '—'} — ${targetDateIso() || '—'}`}
      titleId="weather-position-market-chart-dialog"
      class="weather-bucket-dialog"
      bodyClass="weather-bucket-dialog-body"
    >
      <Show when={loading()}>
        <p class="form-hint">Chargement du graphique…</p>
      </Show>

      <Show when={error() && !loading()}>
        <p class="form-hint weather-settings-error">{error()}</p>
      </Show>

      <Show when={!loading() && !error() && city()}>
        {(c) => {
          const data = c();
          return (
            <>
              <SeriesChart
                buckets={buckets()}
                minPrice={minPrice()}
                markers={markers()}
                renderHeader={() => (
                  <Show when={data.forecastMean != null}>
                    <span class="weather-bucket-forecast-annot">
                      Forecast {data.forecastMean!.toFixed(1)}° ±{' '}
                      {data.forecastStdDev != null
                        ? `${data.forecastStdDev.toFixed(1)}°`
                        : '?'}
                    </span>
                  </Show>
                )}
              />
              <WeatherPositionChartSummary position={pos()} />
              <label class="weather-data-filter weather-bucket-min-price">
                <span>Prix min</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={minPrice()}
                  onInput={(e) => {
                    const v = Number(e.currentTarget.value);
                    setMinPrice(Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
                  }}
                  title="N’afficher que les buckets dont le prix moyen (hors zéros de fin de vie) dépasse ce seuil (0 à 1)"
                />
              </label>
            </>
          );
        }}
      </Show>
    </Dialog>
  );
}
