import { Show } from 'solid-js';
import {
  fetchBucketTickDates,
  fetchBucketTickTimeline,
  type BucketTimelineCity,
} from '../api';
import {
  UI_KEYS,
  WeatherTimelineView,
  type WeatherTimelineDateEntry,
  type WeatherTimelineSource,
} from './WeatherTimelineView';
import { formatTimelineBucketLabel, formatBucketTargetLabel, toChartPoints } from '../lib/weather-position';
import { FIDELITY_OPTIONS } from '../lib/fidelity-options';

const source: WeatherTimelineSource<BucketTimelineCity> = {
  dateKey: UI_KEYS.weatherAlgoTimelineDate,
  maxTicksKey: UI_KEYS.weatherAlgoTimelineMaxTicks,
  minPriceKey: UI_KEYS.weatherAlgoTimelineMinPrice,
  minPriceDefault: 0.1,
  fidelityKey: UI_KEYS.weatherAlgoTimelineFidelity,
  fidelityOptions: FIDELITY_OPTIONS,
  fidelityDefault: '15',
  fidelityRequired: true,
  unitLabel: 'tick',
  dialogTitleId: 'weather-bucket-city-dialog',

  fetchDates: async (): Promise<WeatherTimelineDateEntry[]> => {
    const res = await fetchBucketTickDates();
    return res.dates.map((d) => ({
      key: d.targetDateIso,
      label: `${d.targetDateIso} — ${d.cityCount} ville${d.cityCount > 1 ? 's' : ''}, ${d.tickCount.toLocaleString()} ticks`,
    }));
  },

  fetchTimeline: async (targetDateIso, maxTicks, fidelity) => {
    const res = await fetchBucketTickTimeline(targetDateIso, {
      maxTicks,
      fidelityMinutes: fidelity ? Number(fidelity) : undefined,
    });
    return res.dates[0]?.cities ?? [];
  },

  toCityData: (city) => ({
    key: city.cityNormalized,
    bucketCount: city.bucketCount,
    firstRecordedAt: city.firstRecordedAt,
    lastRecordedAt: city.lastRecordedAt,
    raw: city,
    buckets: city.buckets.map((b) => ({
      label: formatBucketTargetLabel(b),
      fullLabel: formatTimelineBucketLabel(b),
      series: toChartPoints(b.series),
    })),
  }),

  renderCityCardExtra: (city) => (
    <div class="weather-data-card-cadence">
      <span class="weather-data-card-cadence-label">Forecast</span>
      <span class="weather-data-card-cadence-value">
        {city.forecastMean != null ? `${city.forecastMean.toFixed(1)}°` : '—'}
        {city.forecastStdDev != null ? ` ± ${city.forecastStdDev.toFixed(1)}` : ''}
      </span>
    </div>
  ),

  renderChartHeader: (city) => (
    <Show when={city.forecastMean != null}>
      <span class="weather-bucket-forecast-annot">
        Forecast {city.forecastMean!.toFixed(1)}° ±{' '}
        {city.forecastStdDev != null ? `${city.forecastStdDev.toFixed(1)}°` : '?'}
      </span>
    </Show>
  ),

  renderDialogSummary: (city) => (
    <p class="form-hint">
      {city.bucketCount} buckets
    </p>
  ),
};

export function WeatherBucketTimelineView() {
  return <WeatherTimelineView source={source} />;
}
