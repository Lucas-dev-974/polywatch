import { createSignal, For, onMount, Show } from 'solid-js';
import {
  fetchBucketTickDates,
  fetchBucketTickTimeline,
  type BucketTickDateEntry,
  type BucketTimelineBucket,
  type BucketTimelineCity,
  type BucketTimelineSeriesPoint,
} from '../api';
import {
  UI_KEYS,
  WEATHER_ALGO_TIMELINE_MAX_TICKS,
  usePersistedSignal,
} from '../lib/ui-persistence';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { useChartWidth } from '../hooks/useChartWidth';
import { buildChartXTicks, formatUpDownChartTime } from '../lib/updown-price-chart';

const SERIES_PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#8b5cf6',
];

interface ChartPoint {
  t: number;
  y: number;
}

function bucketLabel(bucket: BucketTimelineBucket): string {
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

function bucketTargetLabel(bucket: BucketTimelineBucket): string {
  const { bucketComparison, bucketTarget, bucketLow, bucketHigh } = bucket;
  const fmt = (v: number | null) => (v == null ? '?' : `${v}°`);
  if (bucketComparison === 'between' && bucketLow != null && bucketHigh != null) {
    return `${fmt(bucketLow)}–${fmt(bucketHigh)}`;
  }
  return fmt(bucketTarget);
}

function formatChartTime(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 6 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Convertit une série (avec éventuels trous yesPrice null) en segments continus de points. */
function splitSegments(series: BucketTimelineSeriesPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const p of series) {
    const t = new Date(p.recordedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (p.yesPrice == null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push({ t, y: p.yesPrice });
  }
  if (current.length) segments.push(current);
  return segments;
}

const CHART_H = 220;
const CHART_MARGIN = { top: 12, right: 16, bottom: 26, left: 44 };
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1.0];

function formatCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

interface HoverState {
  t: number;
  svgX: number;
}

function BucketTicksChart(props: {
  buckets: BucketTimelineBucket[];
  forecastMean: number | null;
  forecastStdDev: number | null;
}) {
  const segments = props.buckets.map((b) => ({ bucket: b, segments: splitSegments(b.series) }));
  const [wrapEl, setWrapEl] = createSignal<HTMLDivElement>();
  const width = useChartWidth(wrapEl);

  const [hiddenSeries, setHiddenSeries] = createSignal<Set<number>>(new Set());
  const [hovered, setHovered] = createSignal<HoverState | null>(null);

  const toggleSeries = (idx: number) => {
    const next = new Set(hiddenSeries());
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setHiddenSeries(next);
  };

  const visibleSegments = () => segments.filter((_, i) => !hiddenSeries().has(i));
  const visibleFlat = () => visibleSegments().flatMap((s) => s.segments).flat();
  const totalPoints = () => visibleFlat().length;
  const visibleCount = () => visibleSegments().length;

  // Dernier prix YES connu d'un bucket (pour l'affichage dans la légende).
  const lastPrice = (s: { segments: ChartPoint[][] }): number | null => {
    for (let i = s.segments.length - 1; i >= 0; i--) {
      const seg = s.segments[i]!;
      if (seg.length > 0) return seg[seg.length - 1]!.y;
    }
    return null;
  };

  const minT = () => {
    const flat = visibleFlat();
    if (flat.length === 0) return 0;
    return Math.min(...flat.map((p) => p.t));
  };
  const maxT = () => {
    const flat = visibleFlat();
    if (flat.length === 0) return 1;
    return Math.max(...flat.map((p) => p.t));
  };

  const plotW = () => Math.max(0, width() - CHART_MARGIN.left - CHART_MARGIN.right);
  const plotH = () => Math.max(0, CHART_H - CHART_MARGIN.top - CHART_MARGIN.bottom);
  const spanT = () => maxT() - minT() || 1;
  const xPos = (t: number) => CHART_MARGIN.left + ((t - minT()) / spanT()) * plotW();
  // Axe Y fixe [0,1] : prix 1.0 en haut, 0.0 en bas.
  const yPos = (p: number) => CHART_MARGIN.top + (1 - p) * plotH();

  const xTicks = () => buildChartXTicks(minT(), maxT());
  const yTicks = () => Y_TICKS;

  const onMouseMove = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const flat = visibleFlat();
    if (flat.length === 0) {
      setHovered(null);
      return;
    }
    // Convertir la position souris en temps via l'échelle X.
    const t = minT() + ((svgX - CHART_MARGIN.left) / plotW()) * spanT();
    // Trouver le point le plus proche en temps parmi les séries visibles.
    let best: ChartPoint | null = null;
    let bestDist = Infinity;
    for (const p of flat) {
      const d = Math.abs(p.t - t);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best) {
      setHovered({ t: best.t, svgX: xPos(best.t) });
    }
  };

  const onMouseLeave = () => setHovered(null);

  // Buckets visibles ayant un point proche du temps survolé (même snapshot).
  const hoveredBuckets = () => {
    const h = hovered();
    if (!h) return [];
    const threshold = spanT() * 0.02;
    const out: Array<{ label: string; color: string; price: number }> = [];
    visibleSegments().forEach((s, i) => {
      for (const seg of s.segments) {
        for (const p of seg) {
          if (Math.abs(p.t - h.t) <= threshold) {
            out.push({
              label: bucketLabel(s.bucket),
              color: SERIES_PALETTE[i % SERIES_PALETTE.length],
              price: p.y,
            });
            break;
          }
        }
        if (out.length > 0 && out[out.length - 1]!.label === bucketLabel(s.bucket)) break;
      }
    });
    return out;
  };

  return (
    <div class="weather-bucket-chart" ref={setWrapEl}>
      <div class="weather-bucket-chart-header">
        <Show when={props.forecastMean != null}>
          <span class="weather-bucket-forecast-annot">
            Forecast {props.forecastMean!.toFixed(1)}° ±{' '}
            {props.forecastStdDev != null ? `${props.forecastStdDev.toFixed(1)}°` : '?'}
          </span>
        </Show>
        <span class="weather-bucket-chart-tick-count">{totalPoints()} points</span>
      </div>
      <div class="weather-bucket-chart-wrap">
        <svg
          class="weather-bucket-chart-svg"
          viewBox={`0 0 ${width()} ${CHART_H}`}
          width="100%"
          height={CHART_H}
          role="img"
          aria-label="Évolution des prix YES par bucket"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        >
          <Show when={totalPoints() > 0}>
            <For each={xTicks()}>
              {(tick) => (
                <line
                  class="weather-bucket-chart-grid-x"
                  x1={xPos(tick.t)}
                  y1={CHART_MARGIN.top}
                  x2={xPos(tick.t)}
                  y2={CHART_MARGIN.top + plotH()}
                />
              )}
            </For>
            <For each={yTicks()}>
              {(tick) => (
                <g class="weather-bucket-chart-grid-y">
                  <line
                    x1={CHART_MARGIN.left}
                    y1={yPos(tick)}
                    x2={CHART_MARGIN.left + plotW()}
                    y2={yPos(tick)}
                  />
                  <text
                    class="weather-bucket-chart-axis-y"
                    x={CHART_MARGIN.left - 8}
                    y={yPos(tick)}
                    text-anchor="end"
                    dominant-baseline="middle"
                  >
                    {formatCents(tick)}
                  </text>
                </g>
              )}
            </For>
            <For each={xTicks()}>
              {(tick) => (
                <text
                  class="weather-bucket-chart-axis-x"
                  x={xPos(tick.t)}
                  y={CHART_H - 6}
                  text-anchor="middle"
                >
                  {tick.label}
                </text>
              )}
            </For>
            <For each={visibleSegments()}>
              {(s, i) => (
                <For each={s.segments}>
                  {(seg) => (
                    <path
                      d={seg
                        .map(
                          (p, idx) =>
                            `${idx === 0 ? 'M' : 'L'}${xPos(p.t).toFixed(1)},${yPos(p.y).toFixed(1)}`,
                        )
                        .join(' ')}
                      fill="none"
                      stroke={SERIES_PALETTE[i() % SERIES_PALETTE.length]}
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  )}
                </For>
              )}
            </For>
            <Show when={hovered()}>
              <line
                class="weather-bucket-crosshair"
                x1={hovered()!.svgX}
                y1={CHART_MARGIN.top}
                x2={hovered()!.svgX}
                y2={CHART_MARGIN.top + plotH()}
              />
            </Show>
          </Show>
          <Show when={totalPoints() === 0}>
            <text
              class="weather-bucket-chart-axis-x"
              x={width() / 2}
              y={CHART_H / 2}
              text-anchor="middle"
            >
              Aucun point de série
            </text>
          </Show>
        </svg>
        <Show when={hovered() && hoveredBuckets().length > 0}>
          <div
            class="weather-bucket-tooltip"
            style={{
              left: `${hovered()!.svgX}px`,
              top: `${CHART_MARGIN.top}px`,
            }}
          >
            <strong>{formatUpDownChartTime(hovered()!.t, spanT())}</strong>
            <For each={hoveredBuckets()}>
              {(b) => (
                <div class="weather-bucket-tooltip-row">
                  <span
                    class="weather-bucket-legend-swatch"
                    style={{ background: b.color }}
                  />
                  <span class="weather-bucket-tooltip-label">{b.label}</span>
                  <span class="weather-bucket-tooltip-price">{formatCents(b.price)}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="weather-bucket-legend">
        <div class="weather-bucket-legend-header">
          <span class="weather-bucket-legend-title">Buckets</span>
          <span class="weather-bucket-legend-count">
            {visibleCount()} / {segments.length} affichés
          </span>
        </div>
        <div class="weather-bucket-legend-list">
          <For each={segments}>
            {(s, i) => {
              const hidden = () => hiddenSeries().has(i());
              const price = lastPrice(s);
              const color = SERIES_PALETTE[i() % SERIES_PALETTE.length];
              return (
                <div
                  role="button"
                  tabindex="0"
                  class={() => `weather-bucket-legend-item${hidden() ? ' weather-bucket-legend-item--hidden' : ''}`}
                  style={{ 'border-color': color }}
                  onClick={() => toggleSeries(i())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSeries(i());
                    }
                  }}
                  title={() => (hidden() ? 'Afficher la série' : 'Masquer la série')}
                >
                  <span
                    class="weather-bucket-legend-swatch"
                    style={{ background: color }}
                  />
                  <span class="weather-bucket-legend-label">
                    {bucketTargetLabel(s.bucket)}
                  </span>
                  <span class="weather-bucket-legend-sep" />
                  <span class="weather-bucket-legend-price">
                    {price != null ? formatCents(price) : '—'}
                  </span>
                  <Show when={!hidden()}>
                    <span class="weather-bucket-legend-eye" aria-hidden="true">
                      <Icon name="eye" size={13} />
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

function CityCard(props: {
  city: BucketTimelineCity;
  onClick: () => void;
}) {
  const c = props.city;
  return (
    <button type="button" class="weather-data-card" onClick={props.onClick}>
      <div class="weather-data-card-header">
        <div class="weather-data-card-heading">
          <span class="weather-data-card-title">{c.cityNormalized}</span>
          <code class="weather-data-card-table">
            {c.bucketCount} bucket{c.bucketCount > 1 ? 's' : ''}
          </code>
        </div>
        <span class="weather-data-card-count">{c.bucketCount}</span>
      </div>
      <div class="weather-data-card-cadence">
        <span class="weather-data-card-cadence-label">Forecast</span>
        <span class="weather-data-card-cadence-value">
          {c.forecastMean != null ? `${c.forecastMean.toFixed(1)}°` : '—'}
          {c.forecastStdDev != null ? ` ± ${c.forecastStdDev.toFixed(1)}` : ''}
        </span>
      </div>
      <dl class="weather-data-card-stats">
        <div>
          <dt>Premier tick</dt>
          <dd>{formatChartTime(new Date(c.firstRecordedAt).getTime(), 0)}</dd>
        </div>
        <div>
          <dt>Dernier tick</dt>
          <dd>{formatChartTime(new Date(c.lastRecordedAt).getTime(), 0)}</dd>
        </div>
        <div class="weather-data-card-cta" aria-hidden="true">
          <span>Voir</span>
          <span class="weather-data-card-cta-arrow">→</span>
        </div>
      </dl>
    </button>
  );
}

export function WeatherBucketTimelineView() {
  const [dates, setDates] = createSignal<BucketTickDateEntry[]>([]);
  const [selectedDate, setSelectedDate] = usePersistedSignal(
    UI_KEYS.weatherAlgoTimelineDate,
    '',
    (value): value is string => typeof value === 'string',
  );
  const [cities, setCities] = createSignal<BucketTimelineCity[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [openCity, setOpenCity] = createSignal<BucketTimelineCity | null>(null);
  const [maxTicks, setMaxTicks] = usePersistedSignal(
    UI_KEYS.weatherAlgoTimelineMaxTicks,
    2000,
    (value): value is number =>
      typeof value === 'number' &&
      (WEATHER_ALGO_TIMELINE_MAX_TICKS as readonly number[]).includes(value),
  );

  async function loadDates() {
    try {
      const res = await fetchBucketTickDates();
      setDates(res.dates);
      if (res.dates.length === 0) return;
      const current = selectedDate();
      const match = res.dates.some((d) => d.targetDateIso === current);
      if (!match) {
        setSelectedDate(res.dates[0]!.targetDateIso);
        void loadTimeline(res.dates[0]!.targetDateIso);
      } else {
        void loadTimeline(current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dates indisponibles');
    }
  }

  async function loadTimeline(targetDateIso: string) {
    setLoading(true);
    setError(null);
    setCities([]);
    setOpenCity(null);
    try {
      const res = await fetchBucketTickTimeline(targetDateIso, {
        maxTicks: maxTicks(),
      });
      setCities(res.dates[0]?.cities ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Timeline indisponible');
    }
    setLoading(false);
  }

  onMount(() => {
    void loadDates();
  });

  function onDateChange(value: string) {
    setSelectedDate(value);
    if (value) void loadTimeline(value);
  }

  return (
    <div class="weather-bucket-timeline-view">
      <div class="weather-bucket-timeline-bar">
        <label class="weather-data-filter">
          <span>Date cible</span>
          <select
            value={selectedDate()}
            onChange={(e) => onDateChange(e.currentTarget.value)}
            disabled={loading()}
          >
            <Show when={dates().length === 0}>
              <option value="">Aucune date</option>
            </Show>
            <For each={dates()}>
              {(d) => (
                <option value={d.targetDateIso}>
                  {d.targetDateIso} — {d.cityCount} ville{d.cityCount > 1 ? 's' : ''},{' '}
                  {d.tickCount.toLocaleString()} ticks
                </option>
              )}
            </For>
          </select>
        </label>
        <label class="weather-data-filter">
          <span>Points max</span>
          <select
            value={String(maxTicks())}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v)) {
                setMaxTicks(v);
                if (selectedDate()) void loadTimeline(selectedDate());
              }
            }}
            disabled={loading()}
          >
            <option value="500">500</option>
            <option value="2000">2000</option>
            <option value="5000">5000</option>
          </select>
        </label>
        <button type="button" class="btn btn-sm btn-secondary" onClick={() => void loadDates()}>
          Actualiser
        </button>
      </div>

      <Show when={error()}>
        <p class="form-hint weather-settings-error">{error()}</p>
      </Show>

      <Show when={loading()}>
        <p class="form-hint">Chargement…</p>
      </Show>

      <Show when={!loading() && selectedDate() && cities().length > 0}>
        <div class="weather-data-cards">
          <For each={cities()}>
            {(city) => <CityCard city={city} onClick={() => setOpenCity(city)} />}
          </For>
        </div>
      </Show>

      <Show when={!loading() && selectedDate() && cities().length === 0}>
        <p class="form-hint">Aucune ville enregistrée pour cette date cible.</p>
      </Show>

      <Dialog
        open={openCity() !== null}
        onClose={() => setOpenCity(null)}
        title={
          openCity()
            ? `${openCity()!.cityNormalized} — ${selectedDate()}`
            : 'Détail ville'
        }
        titleId="weather-bucket-city-dialog"
        class="weather-bucket-dialog"
        bodyClass="weather-bucket-dialog-body"
      >
        <Show when={openCity()}>
          {(c) => (
            <>
              <p class="form-hint">
                Forecast : {c().forecastMean != null ? `${c().forecastMean.toFixed(1)}°` : '—'}
                {c().forecastStdDev != null ? ` ± ${c().forecastStdDev.toFixed(1)}°` : ''} ·{' '}
                {c().bucketCount} buckets
              </p>
              <BucketTicksChart
                buckets={c().buckets}
                forecastMean={c().forecastMean}
                forecastStdDev={c().forecastStdDev}
              />
            </>
          )}
        </Show>
      </Dialog>
    </div>
  );
}
