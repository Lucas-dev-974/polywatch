import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import {
  UI_KEYS,
  WEATHER_ALGO_TIMELINE_MAX_TICKS,
  usePersistedSignal,
} from '../lib/ui-persistence';
import { Dialog } from './Dialog';
import { useChartWidth } from '../hooks/useChartWidth';
import { buildChartXTicks } from '../lib/updown-price-chart';
import { WeatherSeriesLegend } from './WeatherSeriesLegend';

export { UI_KEYS };

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

export interface WeatherTimelineDateEntry {
  key: string;
  label: string;
}

export interface WeatherTimelineSeriesPoint {
  t: number;
  y: number | null;
}

export interface WeatherTimelineBucketData {
  /** Libellé court affiché dans la légende (ex. `10°`). */
  label: string;
  /** Libellé complet affiché dans le tooltip (ex. `≥ 10°`). */
  fullLabel: string;
  series: WeatherTimelineSeriesPoint[];
}

export interface WeatherTimelineCityData<TCity> {
  key: string;
  bucketCount: number;
  firstRecordedAt: string;
  lastRecordedAt: string;
  buckets: WeatherTimelineBucketData[];
  /** Donnée brute d'origine, exposée aux render props spécifiques. */
  raw: TCity;
}

export interface WeatherTimelineSideOption {
  value: string;
  label: string;
}

export interface WeatherTimelineSource<TCity extends object> {
  /** Clé de persistance de la date sélectionnée. */
  dateKey: string;
  /** Clé de persistance du nombre de points max. */
  maxTicksKey: string;
  /** Clé de persistance du côté sélectionné (optionnel — absente pour bucket ticks). */
  sideKey?: string;
  sideDefault?: string;
  sideOptions?: WeatherTimelineSideOption[];
  /** Clé de persistance du seuil de prix minimum (optionnel — absente si non configurable). */
  minPriceKey?: string;
  /** Seuil de prix minimum par défaut (en dollars, ex. 0.1 = 10¢). */
  minPriceDefault?: number;
  /** Clé de persistance du filtre d'intervalle (optionnel — absent si non configurable). */
  fidelityKey?: string;
  /** Options d'intervalle (ex. 15 min, 1 h). */
  fidelityOptions?: WeatherTimelineSideOption[];
  /** Intervalle par défaut (vide = tous). */
  fidelityDefault?: string;
  /** Unité singulière pour les libellés de stats (ex. `tick`, `point`). */
  unitLabel: string;
  dialogTitleId: string;
  fetchDates: () => Promise<WeatherTimelineDateEntry[]>;
  fetchTimeline: (dateKey: string, maxTicks: number, fidelity?: string) => Promise<TCity[]>;
  toCityData: (city: TCity, side: string | null) => WeatherTimelineCityData<TCity>;
  renderCityCardExtra?: (city: TCity) => JSX.Element;
  renderChartHeader: (
    city: TCity,
    side: string | null,
    totalPoints: number,
  ) => JSX.Element;
  renderDialogSummary: (city: TCity, side: string | null) => JSX.Element;
}

interface ChartPoint {
  t: number;
  y: number;
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

/**
 * Formate toujours la date ET l'heure pour le tooltip crosshair.
 * Inclut les secondes uniquement pour les spans très courts (≤ 15min).
 */
function formatChartTooltipDateTime(t: number, spanMs: number): string {
  const d = new Date(t);
  const baseOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (spanMs > 0 && spanMs <= 15 * 60_000) {
    baseOptions.second = '2-digit';
  }
  return d.toLocaleString('fr-FR', baseOptions);
}

/** Convertit une série (avec éventuels trous y null) en segments continus de points. */
function splitSegments(series: WeatherTimelineSeriesPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const p of series) {
    if (p.y == null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push({ t: p.t, y: p.y });
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

function SeriesChart(props: {
  buckets: WeatherTimelineBucketData[];
  renderHeader: (totalPoints: number) => JSX.Element;
  /** Seuil de prix minimum (en dollars) : les buckets dont le prix moyen est < seuil sont masqués. */
  minPrice: number;
}) {
  /**
   * Prix moyen d'un bucket, en excluant les zéros finaux (effondrement de
   * résolution en fin de vie). Sans cette exclusion, un bucket perdant qui
   * résout à 0 ferait chuter sa moyenne à 0 malgré une cotation significative
   * pendant sa vie.
   */
  const averagePriceOf = (b: WeatherTimelineBucketData): number | null => {
    const prices = b.series
      .map((p) => p.y)
      .filter((y): y is number => y != null);
    if (prices.length === 0) return null;
    let end = prices.length;
    while (end > 0 && prices[end - 1] === 0) end--;
    const meaningful = prices.slice(0, end);
    if (meaningful.length === 0) return null;
    return meaningful.reduce((a, c) => a + c, 0) / meaningful.length;
  };

  const filteredBuckets = () =>
    props.minPrice > 0
      ? props.buckets.filter((b) => {
          const avg = averagePriceOf(b);
          return avg != null && avg >= props.minPrice;
        })
      : props.buckets;

  const segments = () =>
    filteredBuckets().map((b) => ({ bucket: b, segments: splitSegments(b.series) }));
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

  const visibleSegments = () => segments().filter((_, i) => !hiddenSeries().has(i));
  const visibleFlat = () => visibleSegments().flatMap((s) => s.segments).flat();
  const totalPoints = () => visibleFlat().length;
  const visibleCount = () => visibleSegments().length;

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
  const yPos = (p: number) => CHART_MARGIN.top + (1 - p) * plotH();

  const xTicks = () => buildChartXTicks(minT(), maxT(), undefined, plotW());
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
    const t = minT() + ((svgX - CHART_MARGIN.left) / plotW()) * spanT();
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
              label: s.bucket.fullLabel,
              color: SERIES_PALETTE[i % SERIES_PALETTE.length],
              price: p.y,
            });
            break;
          }
        }
        if (out.length > 0 && out[out.length - 1]!.label === s.bucket.fullLabel) break;
      }
    });
    return out;
  };

  return (
    <div class="weather-bucket-chart" ref={setWrapEl}>
      <div class="weather-bucket-chart-header">
        {props.renderHeader(totalPoints())}
        <span class="weather-bucket-chart-tick-count">{totalPoints()} points</span>
      </div>
      <div class="weather-bucket-chart-wrap">
        <svg
          class="weather-bucket-chart-svg"
          viewBox={`0 0 ${width()} ${CHART_H}`}
          width="100%"
          height={CHART_H}
          role="img"
          aria-label="Évolution des prix par bucket"
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
            <strong>{formatChartTooltipDateTime(hovered()!.t, spanT())}</strong>
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
      <WeatherSeriesLegend
        visibleCount={visibleCount()}
        totalCount={segments().length}
        items={segments().map((s, i) => ({
          key: i,
          label: s.bucket.label,
          price: lastPrice(s),
          color: SERIES_PALETTE[i % SERIES_PALETTE.length],
          hidden: hiddenSeries().has(i),
        }))}
        onToggle={toggleSeries}
      />
    </div>
  );
}

function CityCard<T>(props: {
  city: WeatherTimelineCityData<T>;
  unitLabel: string;
  renderExtra?: () => JSX.Element;
  onClick: () => void;
}) {
  const c = props.city;
  return (
    <button type="button" class="weather-data-card" onClick={props.onClick}>
      <div class="weather-data-card-header">
        <div class="weather-data-card-heading">
          <span class="weather-data-card-title">{c.key}</span>
          <code class="weather-data-card-table">
            {c.bucketCount} bucket{c.bucketCount > 1 ? 's' : ''}
          </code>
        </div>
        <span class="weather-data-card-count">{c.bucketCount}</span>
      </div>
      <Show when={props.renderExtra}>{props.renderExtra!()}</Show>
      <dl class="weather-data-card-stats">
        <div>
          <dt>Premier {props.unitLabel}</dt>
          <dd>{formatChartTime(new Date(c.firstRecordedAt).getTime(), 0)}</dd>
        </div>
        <div>
          <dt>Dernier {props.unitLabel}</dt>
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

export function WeatherTimelineView<TCity extends object>(
  props: { source: WeatherTimelineSource<TCity> },
): JSX.Element {
  const source = () => props.source;
  let loadToken = 0;
  const [dates, setDates] = createSignal<WeatherTimelineDateEntry[]>([]);
  const [selectedDate, setSelectedDate] = usePersistedSignal(
    source().dateKey,
    '',
    (value): value is string => typeof value === 'string',
  );
  const [side, setSide] = usePersistedSignal<string>(
    source().sideKey ?? '__unused__',
    source().sideDefault ?? '',
    (value): value is string => typeof value === 'string',
  );
  const [cities, setCities] = createSignal<object[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [openCity, setOpenCity] = createSignal<object | null>(null);
  const [maxTicks, setMaxTicks] = usePersistedSignal(
    source().maxTicksKey,
    2000,
    (value): value is number =>
      typeof value === 'number' &&
      (WEATHER_ALGO_TIMELINE_MAX_TICKS as readonly number[]).includes(value),
  );
  const [minPrice, setMinPrice] = usePersistedSignal(
    source().minPriceKey ?? '__unused__',
    source().minPriceDefault ?? 0,
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  const [fidelity, setFidelity] = usePersistedSignal<string>(
    source().fidelityKey ?? '__unused__',
    source().fidelityDefault ?? '',
    (value): value is string => typeof value === 'string',
  );

  async function loadDates() {
    try {
      const res = await source().fetchDates();
      setDates(res);
      if (res.length === 0) return;
      const current = selectedDate();
      const match = res.some((d) => d.key === current);
      if (!match) {
        setSelectedDate(res[0]!.key);
        void loadTimeline(res[0]!.key);
      } else {
        void loadTimeline(current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dates indisponibles');
    }
  }

  async function loadTimeline(dateKey: string) {
    const token = ++loadToken;
    setLoading(true);
    setError(null);
    setCities([]);
    setOpenCity(null);
    try {
      const res = await source().fetchTimeline(dateKey, maxTicks(), fidelity());
      if (token !== loadToken) return;
      setCities(res as unknown as object[]);
    } catch (err) {
      if (token !== loadToken) return;
      setError(err instanceof Error ? err.message : 'Timeline indisponible');
    }
    if (token !== loadToken) return;
    setLoading(false);
  }

  onMount(() => {
    void loadDates();
  });

  function onDateChange(value: string) {
    setSelectedDate(value);
    if (value) void loadTimeline(value);
  }

  function dateIndex(): number {
    return dates().findIndex((d) => d.key === selectedDate());
  }

  function canStep(dir: number): boolean {
    const i = dateIndex();
    if (i < 0) return false;
    const next = i + dir;
    return next >= 0 && next < dates().length;
  }

  function stepDate(dir: number) {
    const i = dateIndex();
    if (i < 0) return;
    const next = dates()[i + dir];
    if (next) onDateChange(next.key);
  }

  const openCityData = () =>
    openCity() ? source().toCityData(openCity() as TCity, side()) : null;

  return (
    <div class="weather-bucket-timeline-view">
      <div class="weather-bucket-timeline-bar">
        <div class="weather-bucket-timeline-date">
          <span class="weather-data-filter-label">Date cible</span>
          <div class="weather-bucket-timeline-date-control">
            <button
              type="button"
              class="weather-bucket-timeline-step"
              aria-label="Date précédente"
              onClick={() => stepDate(-1)}
              disabled={loading() || !canStep(-1)}
            >
              ‹
            </button>
            <select
              class="weather-bucket-timeline-date-select"
              value={selectedDate()}
              onChange={(e) => onDateChange(e.currentTarget.value)}
              disabled={loading()}
            >
              <Show when={dates().length === 0}>
                <option value="">Aucune date</option>
              </Show>
              <For each={dates()}>
                {(d) => <option value={d.key}>{d.label}</option>}
              </For>
            </select>
            <button
              type="button"
              class="weather-bucket-timeline-step"
              aria-label="Date suivante"
              onClick={() => stepDate(1)}
              disabled={loading() || !canStep(1)}
            >
              ›
            </button>
          </div>
        </div>
        <Show when={source().sideOptions}>
          <label class="weather-data-filter">
            <span>Côté</span>
            <select
              value={side()}
              onChange={(e) => setSide(e.currentTarget.value)}
              disabled={loading()}
            >
              <For each={source().sideOptions!}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={source().fidelityOptions}>
          <label class="weather-data-filter">
            <span>Intervalle</span>
            <select
              value={fidelity()}
              onChange={(e) => {
                setFidelity(e.currentTarget.value);
                if (selectedDate()) void loadTimeline(selectedDate());
              }}
              disabled={loading()}
            >
              <option value="">Tous</option>
              <For each={source().fidelityOptions!}>
                {(o) => <option value={o.value}>{o.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <div class="weather-bucket-timeline-maxticks">
          <span class="weather-data-filter-label">Points max</span>
          <div class="weather-bucket-timeline-segmented" role="group" aria-label="Points max">
            <For each={WEATHER_ALGO_TIMELINE_MAX_TICKS}>
              {(v) => (
                <button
                  type="button"
                  class={`weather-bucket-timeline-seg-btn${maxTicks() === v ? ' active' : ''}`}
                  onClick={() => {
                    setMaxTicks(v);
                    if (selectedDate()) void loadTimeline(selectedDate());
                  }}
                  disabled={loading()}
                >
                  {v.toLocaleString()}
                </button>
              )}
            </For>
          </div>
        </div>
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
            {(city) => {
              const raw = city as TCity;
              const cityData = source().toCityData(raw, side());
              return (
                <CityCard
                  city={cityData}
                  unitLabel={source().unitLabel}
                  renderExtra={
                    source().renderCityCardExtra
                      ? () => source().renderCityCardExtra!(raw)
                      : undefined
                  }
                  onClick={() => setOpenCity(city)}
                />
              );
            }}
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
          openCityData()
            ? `${openCityData()!.key} — ${selectedDate()}`
            : 'Détail ville'
        }
        titleId={source().dialogTitleId}
        class="weather-bucket-dialog"
        bodyClass="weather-bucket-dialog-body"
      >
        <Show when={openCity() && openCityData()}>
          {(c) => (
            <>
              {source().renderDialogSummary(openCity() as TCity, side())}
              <Show when={source().minPriceKey}>
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
                      setMinPrice(
                        Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0,
                      );
                    }}
                    title="N’afficher que les buckets dont le prix moyen (hors zéros de fin de vie) dépasse ce seuil (0 à 1)"
                  />
                </label>
              </Show>
              <SeriesChart
                buckets={c().buckets}
                minPrice={minPrice()}
                renderHeader={(totalPoints) =>
                  source().renderChartHeader(openCity() as TCity, side(), totalPoints)
                }
              />
            </>
          )}
        </Show>
      </Dialog>
    </div>
  );
}
