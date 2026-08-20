import { createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import type { BacktestMarketSeriesDto, BacktestPositionDto, BacktestExcludedTickDto } from '../../api';
import { useChartWidth } from '../../hooks/useChartWidth';
import { buildChartXTicks } from '../../lib/updown-price-chart';
import { formatTs } from './format';
import { usePanZoomViewport } from './usePanZoomViewport';
import { groupVoies, bucketLabel } from './ridge/group';
import { buildRidgeScale, MARGIN_TOP, VOIE_H } from './ridge/scale';
import { RidgeGrid } from './ridge/RidgeGrid';
import { RidgeLines, RidgeCrosshair } from './ridge/RidgeLines';
import { RidgeTooltip } from './ridge/RidgeTooltip';
import { RidgePlayhead } from './ridge/RidgePlayhead';
import { RidgePlayMarkers } from './ridge/RidgePlayMarkers';
import { RidgePlayerControls } from './ridge/RidgePlayerControls';
import { RidgePlayTooltip } from './ridge/RidgePlayTooltip';
import { useRidgePlayer } from './ridge/useRidgePlayer';
import { useRidgePlayerFocus } from './ridge/useRidgePlayerFocus';
import type { RidgeScale, TooltipInfo } from './ridge/types';

const PAD_L = 8;
const Y_AXIS_W = 148;
const X_AXIS_H = 40;

export function BacktestMarketRidgeChart(props: {
  series: BacktestMarketSeriesDto[];
  positions: BacktestPositionDto[];
  excludedTicks?: BacktestExcludedTickDto[];
  from: string;
  to: string;
  enablePlayer?: boolean;
}) {
  const runFrom = () => Date.parse(props.from);
  const runTo = () => Date.parse(props.to);

  // Le player est activé par défaut ; le panel live le désactive explicitement.
  const enablePlayer = () => props.enablePlayer !== false;
  // Checkbox d'activation/désactivation du player dans la toolbar.
  const [playerEnabled, setPlayerEnabled] = createSignal<boolean>(true);
  // Le player est actif si disponible ET activé par la checkbox.
  const playerActive = () => enablePlayer() && playerEnabled();

  const [targetDateFilter, setTargetDateFilter] = createSignal<string>('all');
  const [maxTicks, setMaxTicks] = createSignal<number>(0);
  const [cutGaps, setCutGaps] = createSignal<boolean>(true);
  // true = points d'entrée/sortie au survol uniquement ; false = en permanence.
  const [showEntryExit, setShowEntryExit] = createSignal<boolean>(true);
  // Tracer vertical des ticks exclus.
  const [showExcluded, setShowExcluded] = createSignal<boolean>(true);

  const excludedTs = createMemo<number[]>(() =>
    (props.excludedTicks ?? [])
      .map((e) => Date.parse(e.t))
      .filter((n) => Number.isFinite(n)),
  );

  const allGroups = createMemo(() => groupVoies(props.series, props.positions));

  const targetDates = createMemo(() => {
    const set = new Set<string>();
    for (const g of allGroups()) set.add(g.date);
    return [...set].filter((d) => d !== '_').sort();
  });

  const voies = createMemo(() => {
    const groups = allGroups();
    const filter = targetDateFilter();
    if (filter === 'all') return groups;
    return groups.filter((g) => g.date === filter);
  });

  // ── Player de replay ──────────────────────────────────────────────────
  // Timeline = timestamps uniques triés des points des voies filtrées
  // (P1/P2/P3 : synchronisée avec les courbes affichées, respecte maxTicks).
  const playerTimeline = createMemo<number[]>(() => {
    if (!playerActive()) return [];
    const n = maxTicks();
    const set = new Set<number>();
    for (const voie of voies()) {
      for (const b of voie.buckets) {
        const points = n > 0 ? b.series.points.slice(-n) : b.series.points;
        for (const p of points) {
          const t = Date.parse(p.t);
          if (!Number.isNaN(t)) set.add(t);
        }
      }
    }
    return [...set].sort((a, b) => a - b);
  });

  const player = useRidgePlayer(playerTimeline);

  // Row active au playhead : la voie de la position la plus récemment entrée
  // (entryAt <= playhead). Stable : ne change que lors d'une nouvelle entrée,
  // évitant le saccadement vertical dû à la première voie qui matche un tick.
  const activeVoieIndex = createMemo<number | null>(() => {
    const t = player.playheadT();
    if (t == null) return null;
    const vs = voies();
    // Map conditionId -> index de voie.
    const voieIndexByCondition = new Map<string, number>();
    vs.forEach((voie, i) => {
      for (const b of voie.buckets) {
        if (!voieIndexByCondition.has(b.series.conditionId)) {
          voieIndexByCondition.set(b.series.conditionId, i);
        }
      }
    });
    // Position la plus récemment entrée (entryAt <= t).
    let best: { voieIndex: number; entryT: number } | null = null;
    for (const pos of props.positions) {
      const entryT = Date.parse(pos.entryAt);
      if (Number.isNaN(entryT) || entryT > t) continue;
      const voieIndex = voieIndexByCondition.get(pos.conditionId);
      if (voieIndex == null) continue;
      if (!best || entryT > best.entryT) best = { voieIndex, entryT };
    }
    return best ? best.voieIndex : null;
  });

  const [hoveredPlayPosition, setHoveredPlayPosition] = createSignal<BacktestPositionDto | null>(null);
  const [hoveredPlayXY, setHoveredPlayXY] = createSignal<{ x: number; y: number } | null>(null);

  // Tooltip des points d'entrée/sortie de row (survol).
  const [hoveredRowPosition, setHoveredRowPosition] = createSignal<BacktestPositionDto | null>(null);
  const [hoveredRowXY, setHoveredRowXY] = createSignal<{ x: number; y: number } | null>(null);

  // Convertit des coordonnées SVG (interne au <svg viewBox>) en coordonnées
  // CSS du container racine backtest-ridge-plot (qui inclut toolbar + scroll + axe Y).
  const svgToContainer = (svgX: number, svgY: number): { x: number; y: number } => {
    const svg = plotSvgEl();
    const root = rootEl();
    if (!svg || !root) return { x: svgX, y: svgY };
    const svgRect = svg.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    // Facteur d'échelle SVG → pixels écran.
    const scaleX = svgRect.width / plotW();
    const scaleY = svgRect.height / heightPlot();
    return {
      x: svgRect.left - rootRect.left + svgX * scaleX,
      y: svgRect.top - rootRect.top + svgY * scaleY,
    };
  };

  const onPositionHover = (pos: BacktestPositionDto | null, x: number, y: number) => {
    setHoveredRowPosition(pos);
    setHoveredRowXY(pos ? svgToContainer(x, y) : null);
  };

  // Hover d'un marker du player : positionne le tooltip près du marker.
  const onPlayMarkerHover = (pos: BacktestPositionDto | null) => {
    setHoveredPlayPosition(pos);
    if (pos) {
      const entryT = Date.parse(pos.entryAt);
      const voieIndex = voies().findIndex((v) =>
        v.buckets.some((b) => b.series.conditionId === pos.conditionId),
      );
      if (voieIndex >= 0) {
        setHoveredPlayXY(
          svgToContainer(scale().xPos(entryT), scale().top(voieIndex) + VOIE_H / 2),
        );
      }
    } else {
      setHoveredPlayXY(null);
    }
  };

  // Le clip n'est actif qu'en mode replay (index > 0 ou playing).
  const clipUntilT = createMemo<number | null>(() => {
    if (!playerActive()) return null;
    if (player.currentIndex() > 0 || player.isPlaying()) return player.playheadT();
    return null;
  });

  const [plotEl, setPlotEl] = createSignal<HTMLDivElement>();
  const [plotSvgEl, setPlotSvgEl] = createSignal<SVGSVGElement>();
  const [rootEl, setRootEl] = createSignal<HTMLDivElement>();
  const plotW = useChartWidth(plotEl);

  const { viewport, setViewport, zoomAt, pan, reset } = usePanZoomViewport(runFrom(), runTo());

  const [hoveredT, setHoveredT] = createSignal<number | null>(null);
  const [hoveredY, setHoveredY] = createSignal<number | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal<{ x: number; y: number } | null>(null);

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>();

  // Focus smooth du viewport pendant la lecture du player.
  useRidgePlayerFocus({
    isPlaying: player.isPlaying,
    playheadT: player.playheadT,
    viewport,
    setViewport,
    runFrom: runFrom(),
    runTo: runTo(),
    activeVoieIndex,
    scrollEl,
  });

  const plotH = createMemo(() => Math.max(1, VOIE_H * voies().length));
  const heightPlot = createMemo(() => MARGIN_TOP + plotH());

  const vp = () => viewport();
  const scale = createMemo<RidgeScale>(() => buildRidgeScale(vp().minT, vp().maxT, plotW()));

  const excludedWithinViewport = createMemo<number[]>(() => {
    const minT = vp().minT;
    const maxT = vp().maxT;
    return showExcluded()
      ? excludedTs().filter((t) => t >= minT && t <= maxT)
      : [];
  });

  // ── Hover throttling : un seul update de tooltip par frame (rAF) ──────────
  let pendingHover: { t: number; y: number } | null = null;
  let rafId: number | null = null;
  const flushHover = () => {
    rafId = null;
    if (pendingHover) {
      setHoveredT(pendingHover.t);
      setHoveredY(pendingHover.y);
      pendingHover = null;
    }
  };
  const scheduleHover = (t: number, y: number) => {
    pendingHover = { t, y };
    if (rafId == null) rafId = requestAnimationFrame(flushHover);
  };
  onCleanup(() => {
    if (rafId != null) cancelAnimationFrame(rafId);
  });

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
      if (scroller && dy !== 0) scroller.scrollTop -= dy;
      setDragStart({ x: e.clientX, y: e.clientY });
    } else {
      const local = toLocalXY(e.currentTarget as SVGSVGElement, e.clientX, e.clientY);
      scheduleHover(
        vp().minT + (local.x / plotW()) * (vp().maxT - vp().minT),
        local.y,
      );
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    setDragging(false);
    setDragStart(null);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const onPointerLeave = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingHover = null;
    setHoveredT(null);
    setHoveredY(null);
    setDragging(false);
    setDragStart(null);
  };

  const xTicks = createMemo(() => buildChartXTicks(vp().minT, vp().maxT, undefined, plotW()));

  // Position X de la fin du run (dernier tick) : l'indicateur "now" marque la
  // dernière donnée réelle, pas Date.now() (null si hors du viewport).
  const nowX = createMemo<number | null>(() => {
    const end = runTo();
    if (end < vp().minT || end > vp().maxT) return null;
    return scale().xPos(end);
  });

  // nearestPrice en recherche dichotomique (points triés par temps).
  const nearestPrice = (s: BacktestMarketSeriesDto, t: number): number | null => {
    const n = maxTicks();
    const points = n > 0 ? s.points.slice(-n) : s.points;
    if (points.length === 0) return null;
    // Recherche dichotomique de l'index du point le plus proche de t.
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(points[mid].t) < t) lo = mid + 1;
      else hi = mid;
    }
    // Comparer lo et lo-1 pour trouver le plus proche (en tenant compte des null).
    let best: number | null = null;
    let bestDist = Infinity;
    for (const cand of [lo - 1, lo, lo + 1]) {
      if (cand < 0 || cand >= points.length) continue;
      const p = points[cand];
      if (p.yesPrice == null) continue;
      const d = Math.abs(Date.parse(p.t) - t);
      if (d < bestDist) {
        bestDist = d;
        best = p.yesPrice;
      }
    }
    return best;
  };

  const hoveredVoieIndex = createMemo(() => {
    const y = hoveredY();
    const list = voies();
    if (y == null || list.length === 0) return null;
    const rel = y - MARGIN_TOP;
    if (rel < 0 || rel >= plotH()) return null;
    return Math.floor(rel / VOIE_H);
  });

  // Clé unique d'un bucket dans une row : `${voieIndex}:${bucketIndex}`.
  // null si le curseur n'est sur aucune courbe spécifique.
  const HOVER_BUCKET_TOLERANCE_PX = 8; // distance verticale max pour "survoler" une courbe
  const hoveredBucketKey = createMemo<string | null>(() => {
    const t = hoveredT();
    const y = hoveredY();
    const idx = hoveredVoieIndex();
    if (t == null || y == null || idx == null) return null;
    const sc = scale();
    const group = voies()[idx];
    if (!group) return null;
    const voieTop = sc.top(idx);
    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (let bi = 0; bi < group.buckets.length; bi++) {
      const b = group.buckets[bi];
      const price = nearestPrice(b.series, t);
      if (price == null) continue;
      const py = sc.yPos(price, voieTop);
      const d = Math.abs(py - y);
      if (d < bestDist) {
        bestDist = d;
        bestKey = `${idx}:${bi}`;
      }
    }
    return bestDist <= HOVER_BUCKET_TOLERANCE_PX ? bestKey : null;
  });

  const tooltipInfo = createMemo<TooltipInfo | null>(() => {
    // P10 : masquer le tooltip hover pendant le replay ou au survol d'un marker.
    if (player.isPlaying() || hoveredPlayPosition() != null) return null;
    const t = hoveredT();
    const idx = hoveredVoieIndex();
    const group = idx == null ? null : voies()[idx];
    if (t == null || !group) return null;
    const key = hoveredBucketKey();
    // Si une courbe précise est survolée, on ne garde que son bucket.
    // Sinon, on affiche tous les buckets de la row.
    const selectedBuckets = key != null
      ? group.buckets.filter((_, bi) => `${idx}:${bi}` === key)
      : group.buckets;
    const buckets = selectedBuckets.map((b) => ({
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
  });

  return (
    <div class="backtest-ridge-plot" ref={setRootEl}>
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
          <label class="backtest-ridge-filter">
            <span>Derniers ticks</span>
            <select
              value={maxTicks()}
              onChange={(e) => setMaxTicks(Number(e.currentTarget.value))}
            >
              <option value="0">Tous</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
          <label class="backtest-ridge-filter">
            <span>Couper sur les trous</span>
            <input
              type="checkbox"
              checked={cutGaps()}
              onChange={(e) => setCutGaps(e.currentTarget.checked)}
            />
          </label>
          <label class="backtest-ridge-filter">
            <span>Entry/Exit hover show</span>
            <input
              type="checkbox"
              checked={showEntryExit()}
              onChange={(e) => setShowEntryExit(e.currentTarget.checked)}
            />
          </label>
          <label class="backtest-ridge-filter">
            <span>Ticks exclus</span>
            <input
              type="checkbox"
              checked={showExcluded()}
              onChange={(e) => setShowExcluded(e.currentTarget.checked)}
            />
          </label>
          <Show when={enablePlayer()}>
            <label class="backtest-ridge-filter">
              <span>Player</span>
              <input
                type="checkbox"
                checked={playerEnabled()}
                onChange={(e) => setPlayerEnabled(e.currentTarget.checked)}
              />
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
                ref={setPlotSvgEl}
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
                  <RidgeLines voies={voies()} scale={scale()} hoveredVoieIndex={hoveredVoieIndex} hoveredBucketKey={hoveredBucketKey} maxTicks={maxTicks()} cutGaps={cutGaps()} clipUntilT={clipUntilT()} showEntryExit={showEntryExit()} onPositionHover={onPositionHover} />
                  <Show when={excludedWithinViewport().length > 0}>
                    <For each={excludedWithinViewport()}>
                      {(t) => (
                        <line
                          x1={scale().xPos(t)}
                          y1={MARGIN_TOP}
                          x2={scale().xPos(t)}
                          y2={MARGIN_TOP + plotH()}
                          class="backtest-chart-excluded-line"
                        />
                      )}
                    </For>
                  </Show>
                  <RidgeCrosshair hoveredT={hoveredT()} plotH={plotH()} scale={scale()} />
                  <Show when={playerActive()}>
                    <RidgePlayMarkers
                      positions={props.positions}
                      scale={scale()}
                      voies={voies()}
                      playheadT={player.playheadT()}
                      onHover={onPlayMarkerHover}
                    />
                    <RidgePlayhead playheadT={player.playheadT()} scale={scale()} plotH={plotH()} viewport={vp()} />
                  </Show>
                  <Show when={nowX() != null}>
                    <line
                      x1={nowX()!}
                      y1={MARGIN_TOP}
                      x2={nowX()!}
                      y2={MARGIN_TOP + plotH()}
                      class="backtest-ridge-now"
                    />
                  </Show>
                </g>
              </svg>
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
                <Show when={nowX() != null}>
                  <line
                    x1={nowX()!}
                    y1={0}
                    x2={nowX()!}
                    y2={X_AXIS_H}
                    class="backtest-ridge-now"
                  />
                  <text
                    x={nowX()!}
                    y={X_AXIS_H - 6}
                    text-anchor="middle"
                    class="backtest-ridge-now-label"
                  >
                    fin des données
                  </text>
                </Show>
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
      <Show when={playerActive()}>
        <RidgePlayerControls
          isPlaying={player.isPlaying()}
          currentIndex={player.currentIndex()}
          total={player.total()}
          playheadT={player.playheadT()}
          speed={player.speed()}
          onToggle={player.toggle}
          onSeekIndex={player.seekIndex}
          onSpeed={player.setSpeed}
          onReset={player.reset}
        />
      </Show>
      <RidgeTooltip info={tooltipInfo()} />
      <Show when={playerActive() && hoveredPlayPosition() != null && hoveredPlayXY() != null}>
        <RidgePlayTooltip position={hoveredPlayPosition()} x={hoveredPlayXY()!.x} y={hoveredPlayXY()!.y} />
      </Show>
      <Show when={hoveredRowPosition() != null && hoveredRowXY() != null}>
        <RidgePlayTooltip position={hoveredRowPosition()} x={hoveredRowXY()!.x} y={hoveredRowXY()!.y} />
      </Show>
    </div>
  );
}
