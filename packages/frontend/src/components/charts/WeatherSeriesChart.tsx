import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { useChartWidth } from '../../hooks/useChartWidth';
import { WeatherSeriesLegend } from '../weather/WeatherSeriesLegend';
import type {
  WeatherTimelineBucketData,
} from '../weather-timeline-types';
import { splitSegments } from '../weather-series-chart/segments';
import {
  boundsOf,
  downsampleMinMax,
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
  const filteredBuckets = createMemo(() =>
    filterBucketsByMinPrice(props.buckets, props.minPrice),
  );

  // Borne le nombre de points par segment pour éviter un path SVG géant et un
  // crosshair O(n) quand une fenêtre non bornée (dialog Positions) renvoie des
  // milliers de points par bucket. Le downsampling min-max préserve la forme.
  // Mémoïsé : splitSegments (O(n log n)) + downsampleMinMax par bucket sont
  // coûteux et lus plusieurs fois par rendu (header, légende, grid, lines…).
  const MAX_POINTS_PER_SEGMENT = 2000;
  const segments = createMemo<SegmentedBucket[]>(() =>
    filteredBuckets().map((b) => ({
      bucket: b,
      segments: splitSegments(b.series).map((seg) =>
        downsampleMinMax(seg, MAX_POINTS_PER_SEGMENT),
      ),
    })),
  );

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

  const visibleSegments = createMemo(() =>
    segments().filter((_, i) => !hiddenSeries().has(i)),
  );
  const visibleFlat = createMemo<ChartPoint[]>(() =>
    visibleSegments().flatMap((s) => s.segments).flat(),
  );
  const totalPoints = createMemo(() => visibleFlat().length);
  const visibleCount = createMemo(() => visibleSegments().length);

  // Bornes temporelles mémoïsées : restent réactives aux données asynchrones
  // (le memo se recalcule quand visibleFlat change), mais ne sont pas
  // recalculées à chaque lecture — sans mémoïsation, bounds() était lu ~10×
  // par rendu.
  const bounds = createMemo(() => boundsOf(visibleFlat()));
  const scale = createMemo(() =>
    buildChartScale(width(), bounds().minT, bounds().maxT),
  );

  const visibleMarkers = createMemo(() => {
    const { minT, maxT } = bounds();
    return (props.markers ?? []).filter(
      (m) => m.t >= minT && m.t <= maxT && m.y >= 0 && m.y <= 1,
    );
  });

  const xTicks = createMemo(() => {
    const { minT, maxT } = bounds();
    return buildXTicks(minT, maxT, scale().plotW);
  });

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
    // Les points sont triés par t (segments ASC) : recherche dichotomique O(log n)
    // au lieu d'un scan linéaire O(n) à chaque mousemove — source de freeze quand
    // une fenêtre non bornée (dialog Positions) renvoie des milliers de points.
    let lo = 0;
    let hi = flat.length - 1;
    if (t <= flat[0]!.t) {
      setHovered({ t: flat[0]!.t, svgX: s.xPos(flat[0]!.t) });
      return;
    }
    if (t >= flat[hi]!.t) {
      setHovered({ t: flat[hi]!.t, svgX: s.xPos(flat[hi]!.t) });
      return;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (flat[mid]!.t < t) lo = mid;
      else hi = mid;
    }
    const best =
      Math.abs(flat[lo]!.t - t) <= Math.abs(flat[hi]!.t - t) ? flat[lo]! : flat[hi]!;
    setHovered({ t: best.t, svgX: s.xPos(best.t) });
  };

  const onMouseLeave = () => setHovered(null);

  const hoveredBuckets = createMemo<TooltipRow[]>(() => {
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
  });

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
