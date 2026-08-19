import { createSignal, For, Show } from 'solid-js';
import type { BacktestMarketSeriesDto, BacktestPositionDto } from '../../api';
import { useChartWidth } from '../../hooks/useChartWidth';
import { buildChartXTicks } from '../../lib/updown-price-chart';
import { formatTs } from './format';
import { usePanZoomViewport } from './usePanZoomViewport';
import { groupVoies, bucketLabel } from './ridge/group';
import { buildRidgeScale, MARGIN_TOP, VOIE_H } from './ridge/scale';
import { RidgeGrid } from './ridge/RidgeGrid';
import { RidgeLines, RidgeCrosshair } from './ridge/RidgeLines';
import { RidgeTooltip } from './ridge/RidgeTooltip';
import type { RidgeScale, TooltipInfo } from './ridge/types';

const PAD_L = 8;
const Y_AXIS_W = 148;
const X_AXIS_H = 40;

export function BacktestMarketRidgeChart(props: {
  series: BacktestMarketSeriesDto[];
  positions: BacktestPositionDto[];
  from: string;
  to: string;
}) {
  const runFrom = () => Date.parse(props.from);
  const runTo = () => Date.parse(props.to);

  const [targetDateFilter, setTargetDateFilter] = createSignal<string>('all');

  const allGroups = () => groupVoies(props.series, props.positions);

  const targetDates = () => {
    const set = new Set<string>();
    for (const g of allGroups()) set.add(g.date);
    return [...set].filter((d) => d !== '_').sort();
  };

  const voies = () => {
    const groups = allGroups();
    const filter = targetDateFilter();
    if (filter === 'all') return groups;
    return groups.filter((g) => g.date === filter);
  };

  const [plotEl, setPlotEl] = createSignal<HTMLDivElement>();
  const plotW = useChartWidth(plotEl);

  const { viewport, zoomAt, pan, reset } = usePanZoomViewport(runFrom(), runTo());

  const [hoveredT, setHoveredT] = createSignal<number | null>(null);
  const [hoveredY, setHoveredY] = createSignal<number | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal<{ x: number; y: number } | null>(null);

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>();

  const plotH = () => Math.max(1, VOIE_H * voies().length);
  const heightPlot = () => MARGIN_TOP + plotH();

  const vp = () => viewport();
  const scale = (): RidgeScale => buildRidgeScale(vp().minT, vp().maxT, plotW());

  const toLocalXY = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const local = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const cursorTFromSvg = (svg: SVGSVGElement, clientX: number) => {
    const local = toLocalXY(svg, clientX, 0);
    return vp().minT + (local.x / plotW()) * (vp().maxT - vp().minT);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomAt(cursorTFromSvg(e.currentTarget as SVGSVGElement, e.clientX), e.deltaY < 0 ? 0.8 : 1.25);
  };

  const onPointerDown = (e: PointerEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (dragging() && dragStart()) {
      const dx = e.clientX - dragStart()!.x;
      const dy = e.clientY - dragStart()!.y;
      pan((-dx / plotW()) * (vp().maxT - vp().minT));
      const scroller = scrollEl();
      if (scroller && dy !== 0) scroller.scrollTop += dy;
      setDragStart({ x: e.clientX, y: e.clientY });
    } else {
      const local = toLocalXY(e.currentTarget as SVGSVGElement, e.clientX, e.clientY);
      setHoveredT(vp().minT + (local.x / plotW()) * (vp().maxT - vp().minT));
      setHoveredY(local.y);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    setDragging(false);
    setDragStart(null);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const onPointerLeave = () => {
    setHoveredT(null);
    setHoveredY(null);
    setDragging(false);
    setDragStart(null);
  };

  const xTicks = () => buildChartXTicks(vp().minT, vp().maxT, undefined, plotW());

  const nearestPrice = (s: BacktestMarketSeriesDto, t: number): number | null => {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const p of s.points) {
      if (p.yesPrice == null) continue;
      const d = Math.abs(Date.parse(p.t) - t);
      if (d < bestDist) {
        bestDist = d;
        best = p.yesPrice;
      }
    }
    return best;
  };

  const hoveredVoieIndex = () => {
    const y = hoveredY();
    const list = voies();
    if (y == null || list.length === 0) return null;
    const rel = y - MARGIN_TOP;
    if (rel < 0 || rel >= plotH()) return null;
    return Math.floor(rel / VOIE_H);
  };

  const tooltipInfo = (): TooltipInfo | null => {
    const t = hoveredT();
    const idx = hoveredVoieIndex();
    const group = idx == null ? null : voies()[idx];
    if (t == null || !group) return null;
    const buckets = group.buckets.map((b) => ({
      color: b.color,
      label: bucketLabel(b.series),
      price: nearestPrice(b.series, t),
      position: b.position,
    }));
    const positionBuckets = buckets.filter((b) => b.position);
    return {
      city: group.city ?? '—',
      date: group.date,
      cursorLabel: formatTs(new Date(t).toISOString()),
      buckets,
      hasPositions: positionBuckets.length > 0,
      positionBuckets,
    };
  };

  return (
    <div class="backtest-ridge-plot">
      <div class="backtest-ridge-toolbar">
        <span class="backtest-ridge-hint">Molette : zoom · Glisser : déplacer</span>
        <div class="backtest-ridge-toolbar-right">
          <Show when={targetDates().length > 1}>
            <label class="backtest-ridge-filter">
              <span>Date cible</span>
              <select
                value={targetDateFilter()}
                onChange={(e) => setTargetDateFilter(e.currentTarget.value)}
              >
                <option value="all">Toutes</option>
                <For each={targetDates()}>
                  {(d) => <option value={d}>{d}</option>}
                </For>
              </select>
            </label>
          </Show>
          <button type="button" class="btn btn-sm btn-ghost backtest-ridge-reset-btn" onClick={reset}>
            Réinitialiser
          </button>
        </div>
      </div>
      <Show
        when={voies().length > 0}
        fallback={<p class="form-hint">Aucun marché parcouru sur cette plage.</p>}
      >
        <div class="backtest-ridge-scroll" ref={setScrollEl}>
          <div class="backtest-ridge-grid">
            {/* Axe Y (labels des rows) */}
            <div class="backtest-ridge-axis-y">
              <svg
                viewBox={`0 0 ${Y_AXIS_W} ${heightPlot()}`}
                width={Y_AXIS_W}
                height={heightPlot()}
                role="img"
                aria-label="Axe Y : marchés par date cible"
              >
                <For each={voies()}>
                  {(voie, i) => (
                    <text
                      x={PAD_L}
                      y={scale().top(i()) + VOIE_H / 2 + 4}
                      class={hoveredVoieIndex() === i() ? 'backtest-ridge-label backtest-ridge-label-focused' : 'backtest-ridge-label'}
                      text-anchor="start"
                    >
                      {voie.city ?? '—'} · {voie.date}
                    </text>
                  )}
                </For>
                <text
                  x={10}
                  y={heightPlot() / 2}
                  text-anchor="middle"
                  transform={`rotate(-90 10 ${heightPlot() / 2})`}
                  class="backtest-ridge-axis-title"
                >
                  Prix YES
                </text>
              </svg>
            </div>

            {/* Plot principal */}
            <div class="backtest-ridge-plot-main" ref={setPlotEl}>
              <svg
                viewBox={`0 0 ${plotW()} ${heightPlot()}`}
                width="100%"
                height={heightPlot()}
                role="img"
                aria-label="Courbes de prix des marchés parcourus pendant le backtest (pan/zoom interactif)"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerLeave}
              >
                <defs>
                  <clipPath id="backtest-ridge-clip">
                    <rect x={0} y={MARGIN_TOP} width={plotW()} height={plotH()} />
                  </clipPath>
                </defs>
                <RidgeGrid voies={voies()} xTicks={xTicks()} scale={scale()} />
                <g clip-path="url(#backtest-ridge-clip)">
                  <RidgeLines voies={voies()} scale={scale()} hoveredVoieIndex={hoveredVoieIndex} />
                  <RidgeCrosshair hoveredT={hoveredT()} plotH={plotH()} scale={scale()} />
                </g>
              </svg>
              <RidgeTooltip info={tooltipInfo()} />
            </div>

            {/* Corner (vide) */}
            <div class="backtest-ridge-corner" />

            {/* Axe X (temps) */}
            <div class="backtest-ridge-axis-x">
              <svg
                viewBox={`0 0 ${plotW()} ${X_AXIS_H}`}
                width="100%"
                height={X_AXIS_H}
                role="img"
                aria-label="Axe X : temps"
              >
                <For each={xTicks()}>
                  {(tick) => (
                    <text x={scale().xPos(tick.t)} y={14} text-anchor="middle" class="backtest-ridge-axis-label">
                      {tick.label}
                    </text>
                  )}
                </For>
                <text
                  x={plotW() / 2}
                  y={32}
                  text-anchor="middle"
                  class="backtest-ridge-axis-title"
                >
                  Temps
                </text>
              </svg>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
