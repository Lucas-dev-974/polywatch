import { createMemo, createSignal, For, Show } from 'solid-js';
import type { BacktestMarketSeriesDto, BacktestPositionDto, BacktestExcludedTickDto } from '../../api';
import { useChartWidth } from '../../hooks/useChartWidth';
import { buildChartXTicks } from '../../lib/updown-price-chart';
import { usePanZoomViewport } from './usePanZoomViewport';
import { groupVoies } from './ridge/group';
import { buildRidgeScale, MARGIN_TOP, VOIE_H } from './ridge/scale';
import { RidgeGrid } from './ridge/RidgeGrid';
import { RidgeLines, RidgeCrosshair } from './ridge/RidgeLines';
import { RidgeTooltip } from './ridge/RidgeTooltip';
import { RidgePlayhead } from './ridge/RidgePlayhead';
import { RidgePlayMarkers } from './ridge/RidgePlayMarkers';
import { RidgePlayerControls } from './ridge/RidgePlayerControls';
import { RidgePlayTooltip } from './ridge/RidgePlayTooltip';
import { RidgeToolbar } from './ridge/RidgeToolbar';
import { RidgeAxisY, RidgeAxisX } from './ridge/RidgeAxes';
import { useRidgePlayer } from './ridge/useRidgePlayer';
import { useRidgePlayerFocus } from './ridge/useRidgePlayerFocus';
import { useRidgeVirtualization } from './ridge/useRidgeVirtualization';
import { useRidgeHover } from './ridge/useRidgeHover';
import type { RidgeScale, EnrichedSeries } from './ridge/types';

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
  // Seuil de prix YES moyen (en %, 0 = aucun filtre) pour retenir les buckets.
  const [minAvgYes, setMinAvgYes] = createSignal<number>(20);
  // true = points d'entrée/sortie au survol uniquement ; false = en permanence.
  const [showEntryExit, setShowEntryExit] = createSignal<boolean>(true);
  // Tracer vertical des ticks exclus.
  const [showExcluded, setShowExcluded] = createSignal<boolean>(true);

  const excludedTs = createMemo<number[]>(() =>
    (props.excludedTicks ?? [])
      .map((e) => Date.parse(e.t))
      .filter((n) => Number.isFinite(n)),
  );

  const allGroups = createMemo(() =>
    groupVoies(props.series, props.positions, minAvgYes() / 100),
  );

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

  // ── Virtualisation verticale ──────────────────────────────────────────
    const virtualization = useRidgeVirtualization(voies);

    // ── Player de replay ──────────────────────────────────────────────────
    // Timeline = timestamps uniques triés des points des voies filtrées
    // (P1/P2/P3 : synchronisée avec les courbes affichées, respecte maxTicks).
    const playerTimeline = createMemo<number[]>(() => {
      if (!playerActive()) return [];
      const n = maxTicks();
      const set = new Set<number>();
      for (const voie of voies()) {
        for (const b of voie.buckets) {
                  // Utiliser la série enrichie si dispo (t déjà numérique), sinon fallback
                  const pts = b.enriched?.points ?? b.series.points;
                  const points = n > 0 ? pts.slice(-n) : pts;
                  for (const p of points) {
                    const t = typeof p.t === 'number' ? p.t : Date.parse(p.t);
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

  // Le clip n'est actif qu'en mode replay (index > 0 ou playing).
    const clipUntilT = createMemo<number | null>(() => {
      if (!playerActive()) return null;
      if (player.currentIndex() > 0 || player.isPlaying()) return player.playheadT();
      return null;
    });

    // Reveal width pour le player (clipPath rect coulissant) — remplace clipUntilT re-build
    const revealW = createMemo<number>(() => {
      if (!playerActive()) return 0;
      const head = player.playheadT();
      if (head == null) return 0;
      const vp_ = vp();
      const span = vp_.maxT - vp_.minT;
      if (span <= 0) return plotW();
      const ratio = Math.max(0, Math.min(1, (head - vp_.minT) / span));
      return ratio * plotW();
    });

    const [plotEl, setPlotEl] = createSignal<HTMLDivElement>();
  const [plotSvgEl, setPlotSvgEl] = createSignal<SVGSVGElement>();
  const [rootEl, setRootEl] = createSignal<HTMLDivElement>();
  const plotW = useChartWidth(plotEl);

  const { viewport, setViewport, zoomAt, pan, reset } = usePanZoomViewport(runFrom(), runTo());

  const [dragging, setDragging] = createSignal(false);
  const [dragStart, setDragStart] = createSignal<{ x: number; y: number } | null>(null);

  // ── Hover : crosshair + tooltip (coordonnées, bucket, throttling rAF) ──
  const plotH = createMemo(() => Math.max(1, VOIE_H * voies().length));
  const heightPlot = createMemo(() => MARGIN_TOP + plotH());

  const vp = () => viewport();
  const scale = createMemo<RidgeScale>(() => buildRidgeScale(vp().minT, vp().maxT, plotW()));

  const hover = useRidgeHover({
    plotSvgEl,
    rootEl,
    plotW,
    heightPlot,
    voies,
    scale,
    maxTicks,
    isPlaying: player.isPlaying,
    isHoveringPlayMarker: () => hoveredPlayPosition() != null,
  });

  // ── Focus smooth du viewport pendant la lecture du player ─────────────
  useRidgePlayerFocus({
    isPlaying: player.isPlaying,
    playheadT: player.playheadT,
    viewport,
    setViewport,
    runFrom: runFrom(),
    runTo: runTo(),
    activeVoieIndex,
    scrollEl: virtualization.scrollEl,
  });

  const excludedWithinViewport = createMemo<number[]>(() => {
    const minT = vp().minT;
    const maxT = vp().maxT;
    return showExcluded()
      ? excludedTs().filter((t) => t >= minT && t <= maxT)
      : [];
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
      const scroller = virtualization.scrollEl();
      if (scroller && dy !== 0) scroller.scrollTop -= dy;
      setDragStart({ x: e.clientX, y: e.clientY });
    } else {
      const local = toLocalXY(e.currentTarget as SVGSVGElement, e.clientX, e.clientY);
      hover.scheduleHover(
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
    hover.clearHover();
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

  // Hover d'une position de row : positionne le tooltip près du marker.
  const onPositionHover = (pos: BacktestPositionDto | null, x: number, y: number) => {
    setHoveredRowPosition(pos);
    setHoveredRowXY(pos ? hover.svgToContainer(x, y) : null);
  };

  // Hover d'un marker du player : positionne le tooltip près du marker.
    const onPlayMarkerHover = (pos: BacktestPositionDto | null) => {
      setHoveredPlayPosition(pos);
      if (pos) {
        // Pré-calculer les timestamps des positions pour éviter Date.parse répété
        const entryT = Date.parse(pos.entryAt);
        const voieIndex = voies().findIndex((v) =>
          v.buckets.some((b) => b.series.conditionId === pos.conditionId),
        );
        if (voieIndex >= 0) {
          setHoveredPlayXY(
            hover.svgToContainer(
              scale().xPos(entryT),
              scale().yPos(pos.entryPrice, scale().top(voieIndex)),
            ),
          );
        }
      } else {
        setHoveredPlayXY(null);
      }
    };

  return (
    <div class="backtest-ridge-plot" ref={setRootEl}>
      <RidgeToolbar
        targetDates={targetDates()}
        targetDateFilter={[targetDateFilter, setTargetDateFilter]}
        maxTicks={[maxTicks, setMaxTicks]}
        cutGaps={[cutGaps, setCutGaps]}
        minAvgYes={[minAvgYes, setMinAvgYes]}
        showEntryExit={[showEntryExit, setShowEntryExit]}
        showExcluded={[showExcluded, setShowExcluded]}
        playerEnabled={[playerEnabled, setPlayerEnabled]}
        enablePlayer={enablePlayer()}
        onReset={reset}
      />
      <Show
        when={voies().length > 0}
        fallback={<p class="form-hint">Aucun marché parcouru sur cette plage.</p>}
      >
        <div class="backtest-ridge-scroll" ref={virtualization.setScrollEl} onScroll={virtualization.onScroll}>
          <div class="backtest-ridge-grid">
            {/* Axe Y (labels des rows) */}
            <div class="backtest-ridge-axis-y">
              <RidgeAxisY
                visibleVoies={virtualization.visibleVoies()}
                scale={scale()}
                heightPlot={heightPlot()}
                hoveredVoieIndex={hover.hoveredVoieIndex()}
              />
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
                                  <Show when={playerActive()}>
                                    <clipPath id="backtest-ridge-reveal">
                                      <rect x={0} y={MARGIN_TOP} width={revealW()} height={plotH()} />
                                    </clipPath>
                                  </Show>
                                </defs>
                                <RidgeGrid voies={virtualization.visibleVoies()} xTicks={xTicks()} scale={scale()} plotH={plotH()} />
                                <g clip-path="url(#backtest-ridge-clip)">
                                  <Show when={playerActive()}>
                                    <g clip-path="url(#backtest-ridge-reveal)">
                                      <RidgeLines voies={virtualization.visibleVoies()} scale={scale()} hoveredVoieIndex={hover.hoveredVoieIndex} hoveredBucketKey={hover.hoveredBucketKey} maxTicks={maxTicks()} cutGaps={cutGaps()} showEntryExit={showEntryExit()} onPositionHover={onPositionHover} />
                                    </g>
                                  </Show>
                                  <Show when={!playerActive()}>
                                    <RidgeLines voies={virtualization.visibleVoies()} scale={scale()} hoveredVoieIndex={hover.hoveredVoieIndex} hoveredBucketKey={hover.hoveredBucketKey} maxTicks={maxTicks()} cutGaps={cutGaps()} showEntryExit={showEntryExit()} onPositionHover={onPositionHover} />
                                  </Show>
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
                  <RidgeCrosshair hoveredT={hover.hoveredT()} plotH={plotH()} scale={scale()} />
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
              <RidgeAxisX scale={scale()} plotW={plotW()} xTicks={xTicks()} nowX={nowX()} />
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
      <RidgeTooltip info={hover.tooltipInfo()} />
      <Show when={playerActive() && hoveredPlayPosition() != null && hoveredPlayXY() != null}>
        <RidgePlayTooltip position={hoveredPlayPosition()} x={hoveredPlayXY()!.x} y={hoveredPlayXY()!.y} />
      </Show>
      <Show when={hoveredRowPosition() != null && hoveredRowXY() != null}>
        <RidgePlayTooltip position={hoveredRowPosition()} x={hoveredRowXY()!.x} y={hoveredRowXY()!.y} />
      </Show>
    </div>
  );
}
