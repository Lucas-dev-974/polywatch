import { createSignal, Show, type JSX } from 'solid-js';
import { useChartWidth } from '../../hooks/useChartWidth';
import { WeatherSeriesLegend } from '../weather/WeatherSeriesLegend';
import type {
  WeatherTimelineBucketData,
} from '../weather-timeline-types';
import { splitSegments } from '../weather-series-chart/segments';
import {
  boundsOf,
  filterBucketsByMinPrice,
  lastPriceOf,
} from '../weather-series-chart/compute';
import { buildChartScale, buildXTicks, CHART_H, CHART_MARGIN } from '../weather-series-chart/scale';
import { seriesColor } from '../weather-series-chart/palette';
import { ChartGrid } from '../weather-series-chart/ChartGrid';
import { SeriesLines } from '../weather-series-chart/SeriesLines';
import { PositionMarkers } from '../weather-series-chart/PositionMarkers';
import { Crosshair } from '../weather-series-chart/Crosshair';
import { ChartTooltip } from '../weather-series-chart/ChartTooltip';
import { MarkerLegend } from '../weather-series-chart/MarkerLegend';
import type {
  ChartPoint,
  HoverState,
  SegmentedBucket,
  SeriesChartMarker,
  TooltipRow,
} from '../weather-series-chart/types';

export type { SeriesChartMarker };

export function SeriesChart(props: {
  buckets: WeatherTimelineBucketData[];
  renderHeader: (totalPoints: number) => JSX.Element;
  /** Seuil de prix minimum (en dollars) : les buckets dont le prix moyen est < seuil sont masqués. */
  minPrice: number;
  /** Markers de position (entrée/sortie) superposés sur le graph, alignés sur le temps et le prix. */
  markers?: SeriesChartMarker[];
}) {
  const filteredBuckets = () => filterBucketsByMinPrice(props.buckets, props.minPrice);

  const segments = (): SegmentedBucket[] =>
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
  const visibleFlat = (): ChartPoint[] => visibleSegments().flatMap((s) => s.segments).flat();
  const totalPoints = () => visibleFlat().length;
  const visibleCount = () => visibleSegments().length;

  // Bornes temporelles réactives : si on déstructure ici (non réactif), les
  // données asynchrones (dialog Positions) résolvent APRÈS le mount et la
  // borne reste figée à {0,1} → lignes/labels/markers écrasés à gauche. On
  // recalcule donc les bornes dans un accessor lu à chaque rendu.
  const bounds = () => boundsOf(visibleFlat());
  const scale = () => buildChartScale(width(), bounds().minT, bounds().maxT);

  const visibleMarkers = () => {
    const { minT, maxT } = bounds();
    return (props.markers ?? []).filter(
      (m) => m.t >= minT && m.t <= maxT && m.y >= 0 && m.y <= 1,
    );
  };

  const xTicks = () => {
    const { minT, maxT } = bounds();
    return buildXTicks(minT, maxT, scale().plotW);
  };

  const onMouseMove = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const flat = visibleFlat();
    if (flat.length === 0) {
      setHovered(null);
      return;
    }
    const s = scale();
    const t = s.minT + ((svgX - CHART_MARGIN.left) / s.plotW) * s.spanT;
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
      setHovered({ t: best.t, svgX: s.xPos(best.t) });
    }
  };

  const onMouseLeave = () => setHovered(null);

  const hoveredBuckets = (): TooltipRow[] => {
    const h = hovered();
    if (!h) return [];
    const threshold = scale().spanT * 0.02;
    const out: TooltipRow[] = [];
    visibleSegments().forEach((s, i) => {
      for (const seg of s.segments) {
        for (const p of seg) {
          if (Math.abs(p.t - h.t) <= threshold) {
            out.push({
              label: s.bucket.fullLabel,
              color: seriesColor(i),
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
            <ChartGrid scale={scale()} xTicks={xTicks()} />
            <SeriesLines buckets={visibleSegments()} scale={scale()} />
            <PositionMarkers markers={props.markers ?? []} scale={scale()} />
            <Crosshair hovered={hovered()} scale={scale()} />
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
        <ChartTooltip hovered={hovered()} rows={hoveredBuckets()} spanMs={scale().spanT} />
      </div>
      <WeatherSeriesLegend
        visibleCount={visibleCount()}
        totalCount={segments().length}
        items={segments().map((s, i) => ({
          key: i,
          label: s.bucket.label,
          price: lastPriceOf(s),
          color: seriesColor(i),
          hidden: hiddenSeries().has(i),
        }))}
        onToggle={toggleSeries}
      />
      <Show when={totalPoints() > 0 && visibleMarkers().length > 0}>
        <MarkerLegend markers={visibleMarkers()} />
      </Show>
    </div>
  );
}
