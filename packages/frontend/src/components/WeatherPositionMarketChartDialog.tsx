import { createEffect, createSignal, Show } from 'solid-js';
import {
  fetchBucketTickTimeline,
  type BucketTimelineCity,
} from '../api';
import type { WeatherPosition } from '../hooks/useWeatherAlgoPositions';
import { Dialog } from './Dialog';
import { SeriesChart, type SeriesChartMarker } from './WeatherTimelineView';
import { formatTimelineBucketLabel, formatBucketTargetLabel } from '../lib/weather-position';
import { formatShortDateTime } from '../lib/date';
import { formatPnlAmount, pnlClass as genericPnlClass } from '../lib/position';
import type {
  WeatherTimelineSeriesPoint,
} from './WeatherTimelineView';

function toChartPoints(
  series: Array<{ recordedAt: string; yesPrice: number | null }>,
): WeatherTimelineSeriesPoint[] {
  return series.map((p) => ({
    t: new Date(p.recordedAt).getTime(),
    y: p.yesPrice,
  }));
}

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
  const [minPrice, setMinPrice] = createSignal(0.1);

  const conditionId = () => pos().conditionId;
  const targetDateIso = () => wf()?.targetDate?.slice(0, 10) ?? '';

  async function load() {
    if (!conditionId() || !targetDateIso()) {
      setError('Position sans conditionId ou date cible.');
      return;
    }
    setLoading(true);
    setError(null);
    setCity(null);
    try {
      const res = await fetchBucketTickTimeline(targetDateIso(), {
        conditionId: conditionId(),
        maxTicks: 2000,
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
          const p = pos();
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
              <div class="weather-position-chart-summary">
                <span>
                  Outcome : <strong>{p.outcome}</strong>
                </span>
                <span>
                  Entrée : <strong>{p.entryPrice.toFixed(3)}</strong> USDC
                  {p.openedAt ? ` · ${formatShortDateTime(p.openedAt)}` : ''}
                </span>
                <Show when={p.status === 'open' && p.executableBidVwap != null && p.executableBidVwap > 0}>
                  <span>
                    Bid actuel :{' '}
                    <strong>{(p.executableBidVwap as number).toFixed(3)}</strong> USDC
                  </span>
                </Show>
                <Show when={p.status === 'closed'}>
                  <span>
                    Sortie :{' '}
                    <strong>
                      {p.exitBidVwap != null ? p.exitBidVwap.toFixed(3) : '—'}
                    </strong>{' '}
                    USDC
                    {p.closedAt ? ` · ${formatShortDateTime(p.closedAt)}` : ''}
                  </span>
                  <span>
                    PnL :{' '}
                    <strong class={genericPnlClass(p.realizedPnl)}>
                      {formatPnlAmount(p.realizedPnl, true)}
                    </strong>
                  </span>
                  <Show when={p.closeReason}>
                    <span>
                      Raison : <strong>{p.closeReason}</strong>
                    </span>
                  </Show>
                </Show>
              </div>
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
