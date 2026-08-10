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

const SIDES = ['YES', 'NO'];

function toChartPoints(
  series: Array<{ recordedAt: string; price: number }>,
): WeatherTimelineSeriesPoint[] {
  return series.map((p) => ({
    t: new Date(p.recordedAt).getTime(),
    y: p.price,
  }));
}

function bucketLabel(bucket: {
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
}): string {
  const { bucketComparison, bucketTarget, bucketLow, bucketHigh } = bucket;
  const cmp = bucketComparison;
  const fmt = (v: number | null) => (v == null ? '?' : `${v}°`);
  if (cmp === 'or_below') return `≤ ${fmt(bucketTarget)}`;
  if (cmp === 'or_above') return `≥ ${fmt(bucketTarget)}`;
  if (cmp === 'exact') return fmt(bucketTarget);
  if (cmp === 'between' && bucketLow != null && bucketHigh != null) {
    return `${fmt(bucketLow)}–${fmt(bucketHigh)}`;
  }
  return `${cmp ?? 'bucket'} ${fmt(bucketTarget)}`.trim();
}

function bucketTargetLabel(bucket: {
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
}): string {
  const { bucketComparison, bucketTarget, bucketLow, bucketHigh } = bucket;
  const fmt = (v: number | null) => (v == null ? '?' : `${v}°`);
  if (bucketComparison === 'between' && bucketLow != null && bucketHigh != null) {
    return `${fmt(bucketLow)}–${fmt(bucketHigh)}`;
  }
  return fmt(bucketTarget);
}

const source: WeatherTimelineSource<ClobTimelineCity> = {
  dateKey: UI_KEYS.weatherAlgoClobTimelineDate,
  maxTicksKey: UI_KEYS.weatherAlgoClobTimelineMaxTicks,
  sideKey: UI_KEYS.weatherAlgoClobTimelineSide,
  sideDefault: 'YES',
  sideOptions: SIDES.map((s) => ({ value: s, label: s })),
  minPriceKey: UI_KEYS.weatherAlgoClobTimelineMinPrice,
  minPriceDefault: 0.1,
  unitLabel: 'point',
  dialogTitleId: 'weather-clob-city-dialog',

  fetchDates: async (): Promise<WeatherTimelineDateEntry[]> => {
    const res = await fetchClobPriceHistoryDates();
    return res.dates.map((d) => ({
      key: d.targetDate,
      label: `${d.targetDate} — ${d.cityCount} ville${d.cityCount > 1 ? 's' : ''}, ${d.tickCount.toLocaleString()} points`,
    }));
  },

  fetchTimeline: async (targetDate, maxTicks) => {
    const res = await fetchClobPriceHistoryTimeline(targetDate, { maxTicks });
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
        label: bucketTargetLabel(b),
        fullLabel: bucketLabel(b),
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
