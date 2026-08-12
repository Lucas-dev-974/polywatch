import {
  fetchClobPriceHistoryDates,
  fetchClobPriceHistoryTimeline,
  type ClobTimelineCity,
} from '../api';
import {
  UI_KEYS,
  WeatherTimelineView,
  type WeatherTimelineDateEntry,
  type WeatherTimelineSeriesPoint,
  type WeatherTimelineSource,
} from './WeatherTimelineView';
import { formatTimelineBucketLabel, formatBucketTargetLabel } from '../lib/weather-position';

const SIDES = ['YES', 'NO'];

const FIDELITY_OPTIONS = [
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '15', label: '15 min' },
  { value: '60', label: '1 h' },
  { value: '1440', label: '1 j' },
];

function toChartPoints(
  series: Array<{ recordedAt: string; price: number }>,
): WeatherTimelineSeriesPoint[] {
  return series.map((p) => ({
    t: new Date(p.recordedAt).getTime(),
    y: p.price,
  }));
}

const source: WeatherTimelineSource<ClobTimelineCity> = {
  dateKey: UI_KEYS.weatherAlgoClobTimelineDate,
  maxTicksKey: UI_KEYS.weatherAlgoClobTimelineMaxTicks,
  sideKey: UI_KEYS.weatherAlgoClobTimelineSide,
  sideDefault: 'YES',
  sideOptions: SIDES.map((s) => ({ value: s, label: s })),
  minPriceKey: UI_KEYS.weatherAlgoClobTimelineMinPrice,
  minPriceDefault: 0.1,
  fidelityKey: UI_KEYS.weatherAlgoClobTimelineFidelity,
  fidelityOptions: FIDELITY_OPTIONS,
  unitLabel: 'point',
  dialogTitleId: 'weather-clob-city-dialog',

  fetchDates: async (): Promise<WeatherTimelineDateEntry[]> => {
    const res = await fetchClobPriceHistoryDates();
    return res.dates.map((d) => ({
      key: d.targetDate,
      label: `${d.targetDate} — ${d.cityCount} ville${d.cityCount > 1 ? 's' : ''}, ${d.tickCount.toLocaleString()} points`,
    }));
  },

  fetchTimeline: async (targetDate, maxTicks, fidelity) => {
    const res = await fetchClobPriceHistoryTimeline(targetDate, {
      maxTicks,
      fidelityMinutes: fidelity ? Number(fidelity) : undefined,
    });
    return res.dates[0]?.cities ?? [];
  },

  toCityData: (city, side) => {
    const sideVal = side ?? 'YES';
    return {
      key: city.cityNormalized,
      bucketCount: city.bucketCount,
      firstRecordedAt: city.firstRecordedAt,
      lastRecordedAt: city.lastRecordedAt,
      raw: city,
      buckets: city.buckets.map((b) => ({
        label: formatBucketTargetLabel(b),
        fullLabel: formatTimelineBucketLabel(b),
        series: toChartPoints(b.series.filter((p) => p.side === sideVal)),
      })),
    };
  },

  renderChartHeader: (_city, side) => (
    <span class="weather-bucket-forecast-annot">Côté {side}</span>
  ),

  renderDialogSummary: (city, side) => (
    <p class="form-hint">
      {city.bucketCount} buckets · côté {side}
    </p>
  ),
};

export function WeatherClobTimelineView() {
  return <WeatherTimelineView source={source} />;
}
