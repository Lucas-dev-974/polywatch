import { createMemo, createSignal, For, Show } from 'solid-js';
import { useChartWidth } from '../hooks/useChartWidth';
import type { UpDownPricePoint, OutcomeSideLabels } from '../lib/market-chart';
import {
  UPDOWN_CHART_CONFIG,
  computeUpDownPlotLayout,
  findNearestPointIndex,
  formatUpDownChartTime,
  formatUpDownPriceCents,
  computePositionLevelThresholds,
  interpolateOutcomePriceAtTime,
  bidToDisplayPrice,
  resolveLevelLabelYs,
  xPosFromTime,
  yPosFromPrice,
  type UpDownPlotLayout,
  type PriceMode,
} from '../lib/updown-price-chart';
import {
  DEFAULT_OVERLAY_TOGGLES,
  PRICE_GAP_MARKER_THRESHOLD,
  SIGNAL_MARKER_MAX_AGE_MS,
  buildBidAskBandGeometry,
  buildSlExitAttemptMarkers,
  findIlliquidIndices,
  findPartialLiquidityIndices,
  findPriceGapIndices,
  findSignalMarkerIndices,
  hasChartMetrics,
  resolveSignalExecutionStatus,
  type ChartOverlayToggles,
  type SignalExecutionStatus,
} from '../lib/updown-chart-overlays';
import type { ExitAttemptEvent } from '../lib/exit-attempts';
import { formatSlAttemptMarkerLabel } from '../lib/exit-attempts';
import {
  fmtLiquidityStatus,
  liquidityStatusClass,
  resolveMarketLiquidityStatus,
} from '../lib/market-chart-debug-format';
import type { AlgoPriceTickMetrics } from '../lib/market-chart';
import type { Execution } from '../lib/execution';
import { closeExecutionErrorLabel } from '../lib/execution';

export type { UpDownPricePoint };

/** Seuils de position affichés sur le graphique (entrée, SL, TP). */
export interface PositionLevels {
  entryBidVwap: number;
  /** Seuil Stop Loss en points bid. */
  slBidPoints?: number | null;
  /** Seuil Take Profit en points bid. */
  tpBidPoints?: number | null;
  /** Date d'ouverture de la position en ms (pour le marqueur temporel). */
  openedAtMs?: number | null;
  /** Date de clôture de la position en ms (pour le marqueur de sortie). */
  closedAtMs?: number | null;
  /** Outcome de la position (Up, Down, Yes, etc.) pour aligner le marqueur sur la courbe. */
  outcome?: string | null;
  /** Fill price de la dernière SELL execution (prix de sortie). */
  exitBidVwap?: number | null;
}

export interface UpDownPriceChartProps {
  points: UpDownPricePoint[];
  marketStartMs?: number | null;
  marketEndMs?: number | null;
  width?: number;
  height?: number;
  onHoverPointChange?: (point: UpDownPricePoint | null) => void;
  /** Seuils de position (entrée, SL, TP) à afficher sur le graphique. */
  positionLevels?: PositionLevels | null;
  /** Journal des tentatives de sortie non exécutées (marqueurs SL). */
  exitAttempts?: ExitAttemptEvent[];
  /** Dynamic side0/side1 labels for legend and outcome resolution. */
  outcomeLabels?: OutcomeSideLabels | null;
  /** ConditionId of the market shown — used to match signal markers to executions. */
  conditionId?: string | null;
  /** Recent ALGO_OPEN executions for this conditionId, used to color signal markers. */
  executions?: Execution[];
  /** Configured max slippage percent (for signal marker tooltip display). */
  maxSlippagePercent?: number | null;
}

const EMPTY_STATE =
  "Pas assez de données pour afficher le graphique. Le marché n'a peut-être pas encore d'historique de prix enregistré.";

function LiquidityBadge(props: {
  label: string;
  status: AlgoPriceTickMetrics['upLiquidityStatus'];
}) {
  return (
    <span class={`updown-chart-liquidity-badge ${liquidityStatusClass(props.status)}`}>
      {props.label}: {fmtLiquidityStatus(props.status)}
    </span>
  );
}

const OVERLAY_TOGGLE_LABELS: Record<keyof ChartOverlayToggles, string> = {
  showBidAskBands: 'Bandes bid/ask',
  showSignals: 'Signaux',
  showPriceGap: 'Gap',
  showIlliquid: 'Illiquidité',
  showPositionLevels: 'Entrée / SL / TP',
  showPositionExecutionPrice: "Prix d'exécution",
  showPositionExitPrice: 'Prix de sortie',
  showSlExitAttempts: 'Tentatives SL',
};

const OVERLAY_TOGGLE_TITLES: Record<keyof ChartOverlayToggles, string> = {
  showBidAskBands:
    'Enveloppe entre le meilleur bid et le meilleur ask (spread) pour chaque outcome',
  showSignals:
    'Triangles aux instants où la stratégie a émis un signal d’entrée (YES/NO + confiance), dans les 5 dernières secondes du tick',
  showPriceGap:
    'Écart de cohérence binaire |Up + Down − 1| > 3 ¢ — le marché s’éloigne d’un livre parfait',
  showIlliquid: 'Zones où le carnet est illiquide ou partiellement liquable',
  showPositionLevels: 'Lignes horizontales d’entrée, stop-loss et take-profit',
  showPositionExecutionPrice: 'Marqueur du prix d’exécution à l’ouverture',
  showPositionExitPrice: 'Marqueur du prix de sortie à la clôture',
  showSlExitAttempts: 'Tentatives de sortie SL non exécutées',
};

function signalMarkerClass(status: SignalExecutionStatus): string {
  switch (status.kind) {
    case 'executed':
      return 'updown-chart-signal-marker-executed';
    case 'failed':
      return 'updown-chart-signal-marker-failed';
    case 'pending':
      return 'updown-chart-signal-marker-pending';
    case 'not_executed':
      return 'updown-chart-signal-marker-failed';
  }
}

function formatSignalMarkerLabel(
  point: UpDownPricePoint,
  status: SignalExecutionStatus,
  maxSlippagePercent: number | null,
): string {
  const m = point.metrics;
  const outcome = m?.lastSignalOutcome ?? '?';
  const conf =
    m?.lastSignalConfidence != null
      ? ` (${(m.lastSignalConfidence * 100).toFixed(0)}%)`
      : '';
  const age =
    m?.signalAgeMs != null ? ` · âge ${Math.round(m.signalAgeMs)} ms` : '';
  const strategy = m?.lastSignalStrategyId
    ? ` · ${m.lastSignalStrategyId}`
    : '';
  const base = `Signal ${outcome}${conf}${age}${strategy}`;

  switch (status.kind) {
    case 'executed':
      return `${base} · ✅ Exécuté @ ${formatUpDownPriceCents(status.fillPrice)}`;
    case 'failed': {
      const reasonLabel = closeExecutionErrorLabel(status.error) ?? 'échec';
      const isSlippage = status.error === 'slippage_exceeded';
      if (isSlippage) {
        const maxStr =
          maxSlippagePercent != null ? `acceptable ≤ ${maxSlippagePercent}%` : 'acceptable (non configuré)';
        const detStr =
          status.slippagePercent != null
            ? ` · détecté ${status.slippagePercent.toFixed(2)}%`
            : ' · ordre rejeté avant exécution CLOB';
        return `${base} · ❌ ${reasonLabel} · ${maxStr}${detStr}`;
      }
      return `${base} · ❌ ${reasonLabel}`;
    }
    case 'pending':
      return `${base} · ⏳ En attente d'exécution`;
    case 'not_executed':
      return `${base} · ❌ Non exécuté`;
  }
}

function UpDownChartLegend(props: {
  toggles: ChartOverlayToggles;
  onToggle: (key: keyof ChartOverlayToggles) => void;
  metricsAvailable: boolean;
  activeMetrics: () => AlgoPriceTickMetrics | undefined;
  hasPositionLevels: boolean;
  hasExitPrice: boolean;
  hasSlExitAttempts: boolean;
  hasDownData: boolean;
  side0Label: string;
  side1Label: string;
  priceMode: PriceMode;
  onPriceModeChange: (mode: PriceMode) => void;
}) {
  const { up, down } = UPDOWN_CHART_CONFIG.colors;
  const overlayKeys = Object.keys(OVERLAY_TOGGLE_LABELS).filter((k) => {
    const key = k as keyof ChartOverlayToggles;
    if (key === 'showPositionLevels' || key === 'showPositionExecutionPrice') {
      return props.hasPositionLevels;
    }
    if (key === 'showPositionExitPrice') {
      return props.hasExitPrice;
    }
    if (key === 'showSlExitAttempts') {
      return props.hasSlExitAttempts;
    }
    return true;
  }) as (keyof ChartOverlayToggles)[];

  return (
    <div class="updown-chart-toolbar">
      <div class="updown-chart-toolbar-row updown-chart-toolbar-primary">
        <div class="updown-chart-legend-items">
          <span class="updown-chart-legend-item">
            <span class="updown-chart-legend-swatch" style={{ background: up }} />
            {props.side0Label}
          </span>
          <Show when={props.hasDownData}>
            <span class="updown-chart-legend-item">
              <span class="updown-chart-legend-swatch" style={{ background: down }} />
              {props.side1Label}
            </span>
          </Show>
        </div>
        <Show when={props.metricsAvailable && props.activeMetrics()}>
          {(m) => (
            <div class="updown-chart-liquidity-row">
              <Show when={props.hasDownData}>
                <LiquidityBadge label={props.side0Label} status={m().upLiquidityStatus} />
                <LiquidityBadge label={props.side1Label} status={m().downLiquidityStatus} />
              </Show>
              <Show when={!props.hasDownData}>
                <LiquidityBadge label="Marché" status={m().upLiquidityStatus} />
              </Show>
              <Show when={props.hasDownData}>
                <LiquidityBadge
                  label="Marché"
                  status={resolveMarketLiquidityStatus(
                    m().upLiquidityStatus,
                    m().downLiquidityStatus,
                  )}
                />
              </Show>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.metricsAvailable}>
        <div class="updown-chart-toolbar-row updown-chart-toolbar-overlays">
          <For each={overlayKeys}>
            {(key) => (
              <button
                type="button"
                class="updown-chart-toggle-chip"
                classList={{ 'is-active': props.toggles[key] }}
                title={OVERLAY_TOGGLE_TITLES[key]}
                onClick={() => props.onToggle(key)}
              >
                {OVERLAY_TOGGLE_LABELS[key]}
              </button>
            )}
          </For>
        </div>
        <div class="updown-chart-toolbar-row updown-chart-toolbar-price-mode">
          <span class="updown-chart-price-mode-label">Prix :</span>
          <button
            type="button"
            class="updown-chart-toggle-chip"
            classList={{ 'is-active': props.priceMode === 'mid' }}
            onClick={() => props.onPriceModeChange('mid')}
          >
            Mid
          </button>
          <button
            type="button"
            class="updown-chart-toggle-chip"
            classList={{ 'is-active': props.priceMode === 'bid' }}
            onClick={() => props.onPriceModeChange('bid')}
          >
            Bid
          </button>
          <button
            type="button"
            class="updown-chart-toggle-chip"
            classList={{ 'is-active': props.priceMode === 'ask' }}
            onClick={() => props.onPriceModeChange('ask')}
          >
            Ask
          </button>
        </div>
      </Show>
    </div>
  );
}

function UpDownChartMarkerLegend(props: {
  marketStartMs?: number | null;
  marketEndMs?: number | null;
}) {
  return (
    <Show when={props.marketStartMs != null || props.marketEndMs != null}>
      <div class="updown-chart-marker-legend">
        <Show when={props.marketStartMs != null}>
          <span class="updown-chart-marker-legend-item">
            <span class="updown-chart-marker-legend-line" />
            Début fenêtre
          </span>
        </Show>
        <Show when={props.marketEndMs != null}>
          <span class="updown-chart-marker-legend-item">
            <span class="updown-chart-marker-legend-line" />
            Fin fenêtre
          </span>
        </Show>
      </div>
    </Show>
  );
}

function PositionLevelLine(props: {
  x1: number;
  x2: number;
  y: number;
  lineClass: string;
}) {
  return (
    <line
      class={props.lineClass}
      x1={props.x1}
      y1={props.y}
      x2={props.x2}
      y2={props.y}
    />
  );
}

function PositionLevelLabel(props: {
  x: number;
  y: number;
  text: string;
  levelKey: 'entry' | 'sl' | 'tp';
}) {
  const bgClass = `updown-chart-level-label-bg updown-chart-level-label-bg-${props.levelKey}`;
  const textClass = `updown-chart-level-label-text updown-chart-level-label-text-${props.levelKey}`;
  // Left-axis aligned label: text-anchor end at x = margin.left - 8 (same
  // column as the regular Y-axis ticks 0¢/25¢/.../100¢). The background rect
  // is clamped to the SVG left edge so it never overflows the gutter.
  const width = 38;
  const height = 16;
  const rectX = Math.max(0, props.x - width);
  const rectWidth = props.x - rectX;
  return (
    <g class="updown-chart-level-label" pointer-events="none">
      <rect
        class={bgClass}
        x={rectX}
        y={props.y - height / 2}
        width={rectWidth}
        height={height}
        rx={3}
      />
      <text
        class={textClass}
        x={props.x - 2}
        y={props.y}
        text-anchor="end"
        dominant-baseline="middle"
      >
        {props.text}
      </text>
    </g>
  );
}

function PositionLevelLines(props: {
  levels: PositionLevels;
  yPos: (price: number) => number;
  x1: number;
  x2: number;
  plotTop: number;
  plotBottom: number;
  points: UpDownPricePoint[];
  priceMode: PriceMode;
  outcomeLabels?: OutcomeSideLabels | null;
}) {
  const { levels, yPos, x1, x2, plotTop, plotBottom, points, priceMode, outcomeLabels } = props;
  const thresholds = computePositionLevelThresholds(levels);
  const openedAtMs = levels.openedAtMs ?? 0;
  const outcome = levels.outcome;

  const toDisplayPrice = (bidPrice: number) =>
    bidToDisplayPrice(bidPrice, priceMode, points, openedAtMs, outcome, outcomeLabels);

  const entryPrice = toDisplayPrice(thresholds.entry);
  const slPrice = thresholds.sl != null ? toDisplayPrice(thresholds.sl) : null;
  const tpPrice = thresholds.tp != null ? toDisplayPrice(thresholds.tp) : null;

  const lines: Array<{
    key: 'entry' | 'sl' | 'tp';
    price: number;
    lineClass: string;
  }> = [
    {
      key: 'entry',
      price: entryPrice,
      lineClass: 'updown-chart-entry-line',
    },
  ];

  if (slPrice != null) {
    lines.push({
      key: 'sl',
      price: slPrice,
      lineClass: 'updown-chart-sl-line',
    });
  }
  if (tpPrice != null) {
    lines.push({
      key: 'tp',
      price: tpPrice,
      lineClass: 'updown-chart-tp-line',
    });
  }

  const lineYs = lines.map((line) => yPos(line.price));
  // Resolve label Ys with anti-overlap, then clamp within the plot area
  // so labels never escape above the top or below the bottom of the chart.
  const labelYs = resolveLevelLabelYs(lineYs, 18).map((y) =>
    Math.min(Math.max(y, plotTop + 10), plotBottom - 10),
  );
  // Align level value labels with the Y-axis ticks (same column as
  // 0¢/25¢/.../100¢), 8px left of the plot's left edge.
  const labelX = x1 - 8;

  return (
    <>
      <For each={lines}>
        {(line, index) => (
          <>
            <PositionLevelLine
              y={lineYs[index()]!}
              lineClass={line.lineClass}
              x1={x1}
              x2={x2}
            />
            <PositionLevelLabel
              x={labelX}
              y={labelYs[index()]!}
              text={formatUpDownPriceCents(line.price)}
              levelKey={line.key}
            />
          </>
        )}
      </For>
    </>
  );
}

function UpDownChartSvg(props: {
  layout: UpDownPlotLayout;
  points: UpDownPricePoint[];
  marketStartMs?: number | null;
  marketEndMs?: number | null;
  toggles: ChartOverlayToggles;
  hoverIndex: () => number | null;
  onHoverIndex: (index: number | null) => void;
  positionLevels?: PositionLevels | null;
  priceMode: PriceMode;
  exitAttempts?: ExitAttemptEvent[];
  outcomeLabels?: OutcomeSideLabels | null;
  /** ConditionId of the market shown — used to match signal markers to executions. */
  conditionId?: string | null;
  /** Recent ALGO_OPEN executions for this conditionId, used to color signal markers. */
  executions?: Execution[];
  /** Configured max slippage percent (for tooltip display). */
  maxSlippagePercent?: number | null;
}) {
  const margin = UPDOWN_CHART_CONFIG.margin;
  const { up, down } = UPDOWN_CHART_CONFIG.colors;
  const ly = () => props.layout;
  const [tooltipPos, setTooltipPos] = createSignal<{ x: number; y: number } | null>(
    null,
  );
  const [hoverLineX, setHoverLineX] = createSignal<number | null>(null);

  const xPos = (t: number) =>
    xPosFromTime(t, ly().minT, ly().maxT, ly().plotW, margin.left);
  const yPos = (price: number) => yPosFromPrice(price, ly().plotH, margin.top);

  const hovered = () => {
    const idx = props.hoverIndex();
    return idx !== null ? props.points[idx] : null;
  };

  const upBandGeometry = createMemo(() =>
    buildBidAskBandGeometry(
      props.points,
      'up',
      ly().minT,
      ly().maxT,
      ly().plotW,
      ly().plotH,
      margin.top,
      margin.left,
    ),
  );

  const downBandGeometry = createMemo(() =>
    buildBidAskBandGeometry(
      props.points,
      'down',
      ly().minT,
      ly().maxT,
      ly().plotW,
      ly().plotH,
      margin.top,
      margin.left,
    ),
  );

  const signalIndices = createMemo(() => findSignalMarkerIndices(props.points));
  const gapIndices = createMemo(() => findPriceGapIndices(props.points));
  const illiquidIndices = createMemo(() => findIlliquidIndices(props.points));
  const partialLiquidityIndices = createMemo(() =>
    findPartialLiquidityIndices(props.points),
  );

  const positionExecutionPriceMarker = createMemo(() => {
    const levels = props.positionLevels;
    const openedAtMs = levels?.openedAtMs;
    const entryPrice = levels?.entryBidVwap;
    if (
      openedAtMs == null ||
      !Number.isFinite(openedAtMs) ||
      entryPrice == null ||
      entryPrice <= 0 ||
      props.points.length === 0
    ) {
      return null;
    }

    return {
      x: xPos(openedAtMs),
      y: yPos(entryPrice),
    };
  });

  const positionExitPriceMarker = createMemo(() => {
    const levels = props.positionLevels;
    const closedAtMs = levels?.closedAtMs;
    const exitBidVwap = levels?.exitBidVwap;
    if (
      closedAtMs == null ||
      !Number.isFinite(closedAtMs) ||
      exitBidVwap == null ||
      exitBidVwap <= 0 ||
      props.points.length === 0
    ) {
      return null;
    }

    return {
      x: xPos(closedAtMs),
      y: yPos(exitBidVwap),
    };
  });

  const slExitAttemptMarkers = createMemo(() =>
    buildSlExitAttemptMarkers(
      props.exitAttempts ?? [],
      ly().minT,
      ly().maxT,
    ),
  );

  const [slAttemptHover, setSlAttemptHover] = createSignal<{
    x: number;
    y: number;
    label: string;
  } | null>(null);

  const [signalHover, setSignalHover] = createSignal<{
    x: number;
    y: number;
    label: string;
  } | null>(null);

  const markerTooltipActive = () => Boolean(slAttemptHover() || signalHover());

  const handleMouseMove = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const wrap = svg.closest('.updown-chart-wrap');
    if (wrap) {
      const wrapRect = wrap.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - wrapRect.left + 12,
        y: e.clientY - wrapRect.top + 12,
      });
    }

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    const svgX = svgPt.x - margin.left;

    if (svgX < 0 || svgX > ly().plotW) {
      setHoverLineX(null);
      props.onHoverIndex(null);
      return;
    }

    setHoverLineX(svgPt.x);
    const t = ly().minT + (svgX / ly().plotW) * (ly().maxT - ly().minT);
    props.onHoverIndex(findNearestPointIndex(props.points, t));
  };

  const markerY = margin.top + ly().plotH - 8;

  return (
    <>
      <svg
        class="updown-chart-svg"
        viewBox={`0 0 ${ly().width} ${ly().height}`}
        width="100%"
        height={ly().height}
        role="img"
        aria-label="Évolution des prix Up/Down"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setHoverLineX(null);
          setTooltipPos(null);
          setSignalHover(null);
          setSlAttemptHover(null);
        }}
      >
        <For each={ly().yTicks}>
          {(tick) => (
            <g>
              <line
                class="updown-chart-grid-y"
                x1={margin.left}
                y1={yPos(tick)}
                x2={margin.left + ly().plotW}
                y2={yPos(tick)}
              />
              <text
                x={margin.left - 8}
                y={yPos(tick)}
                text-anchor="end"
                dominant-baseline="middle"
                class="updown-chart-axis-y"
              >
                {(tick * 100).toFixed(0)}¢
              </text>
            </g>
          )}
        </For>

        <For each={ly().xTicks}>
          {(tick) => (
            <g>
              <line
                class="updown-chart-grid-x"
                x1={xPos(tick.t)}
                y1={margin.top}
                x2={xPos(tick.t)}
                y2={margin.top + ly().plotH}
              />
              <text
                x={xPos(tick.t)}
                y={ly().height - 8}
                text-anchor="middle"
                class="updown-chart-axis-x"
              >
                {tick.label}
              </text>
            </g>
          )}
        </For>

        <Show when={props.marketStartMs != null}>
          <line
            class="updown-chart-marker updown-chart-marker-start"
            x1={xPos(props.marketStartMs!)}
            y1={margin.top}
            x2={xPos(props.marketStartMs!)}
            y2={margin.top + ly().plotH}
            stroke-dasharray="4 2"
          />
        </Show>
        <Show when={props.marketEndMs != null}>
          <line
            class="updown-chart-marker updown-chart-marker-end"
            x1={xPos(props.marketEndMs!)}
            y1={margin.top}
            x2={xPos(props.marketEndMs!)}
            y2={margin.top + ly().plotH}
            stroke-dasharray="4 2"
          />
        </Show>

        <rect
          class="updown-chart-frame"
          x={margin.left}
          y={margin.top}
          width={ly().plotW}
          height={ly().plotH}
          rx="4"
        />

        <Show when={props.toggles.showBidAskBands && upBandGeometry().fills.length > 0}>
          <For each={upBandGeometry().fills}>
            {(d) => <path d={d} class="updown-chart-band updown-chart-band-up" />}
          </For>
          <For each={upBandGeometry().askEdges}>
            {(d) => (
              <path d={d} class="updown-chart-band-edge updown-chart-band-edge-up" />
            )}
          </For>
          <For each={upBandGeometry().bidEdges}>
            {(d) => (
              <path d={d} class="updown-chart-band-edge updown-chart-band-edge-up" />
            )}
          </For>
        </Show>
        <Show when={props.toggles.showBidAskBands && downBandGeometry().fills.length > 0}>
          <For each={downBandGeometry().fills}>
            {(d) => (
              <path d={d} class="updown-chart-band updown-chart-band-down" />
            )}
          </For>
          <For each={downBandGeometry().askEdges}>
            {(d) => (
              <path
                d={d}
                class="updown-chart-band-edge updown-chart-band-edge-down"
              />
            )}
          </For>
          <For each={downBandGeometry().bidEdges}>
            {(d) => (
              <path
                d={d}
                class="updown-chart-band-edge updown-chart-band-edge-down"
              />
            )}
          </For>
        </Show>

        <Show when={hoverLineX() != null}>
          <line
            class="updown-chart-hover-line"
            x1={hoverLineX()!}
            y1={margin.top}
            x2={hoverLineX()!}
            y2={margin.top + ly().plotH}
          />
        </Show>

        <Show when={props.toggles.showIlliquid}>
          <For each={illiquidIndices()}>
            {(idx) => {
              const p = props.points[idx]!;
              const next = props.points[idx + 1];
              const x1 = xPos(p.t);
              const x2 = next ? xPos(next.t) : x1 + 4;
              return (
                <rect
                  class="updown-chart-illiquid-shade"
                  x={x1}
                  y={margin.top}
                  width={Math.max(x2 - x1, 3)}
                  height={ly().plotH}
                />
              );
            }}
          </For>
          <For each={partialLiquidityIndices()}>
            {(idx) => {
              const p = props.points[idx]!;
              const next = props.points[idx + 1];
              const x1 = xPos(p.t);
              const x2 = next ? xPos(next.t) : x1 + 4;
              return (
                <rect
                  class="updown-chart-partial-liquidity-shade"
                  x={x1}
                  y={margin.top}
                  width={Math.max(x2 - x1, 3)}
                  height={ly().plotH}
                />
              );
            }}
          </For>
        </Show>

        <Show when={ly().upPath}>
          <path
            d={ly().upPath}
            fill="none"
            stroke={up}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Show>

        <Show when={ly().downPath}>
          <path
            d={ly().downPath}
            fill="none"
            stroke={down}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Show>

        <Show when={props.toggles.showSignals}>
          <For each={signalIndices()}>
            {(idx) => {
              const p = props.points[idx]!;
              const cx = xPos(p.t);
              const status = () =>
                resolveSignalExecutionStatus(
                  p,
                  props.conditionId ?? '',
                  props.executions ?? [],
                  Date.now(),
                );
              const markerClass = () => signalMarkerClass(status());
              return (
                <g
                  class="updown-chart-signal-hit"
                  onMouseEnter={(e) => {
                    const wrap = (e.currentTarget as SVGGElement).closest(
                      '.updown-chart-wrap',
                    );
                    if (!wrap) return;
                    const wrapRect = wrap.getBoundingClientRect();
                    setSignalHover({
                      x: e.clientX - wrapRect.left + 12,
                      y: e.clientY - wrapRect.top + 12,
                      label: formatSignalMarkerLabel(p, status(), props.maxSlippagePercent ?? null),
                    });
                  }}
                  onMouseLeave={() => setSignalHover(null)}
                >
                  <polygon
                    class={`updown-chart-signal-marker ${markerClass()}`}
                    points={`${cx},${markerY - 8} ${cx - 5},${markerY} ${cx + 5},${markerY}`}
                  />
                  {/* Larger invisible hit target for easier hover */}
                  <circle
                    class="updown-chart-signal-hitarea"
                    cx={cx}
                    cy={markerY - 4}
                    r="10"
                  />
                </g>
              );
            }}
          </For>
        </Show>

        <Show when={props.toggles.showPositionExecutionPrice && positionExecutionPriceMarker()}>
          {(marker) => (
            <g>
              <line
                class="updown-chart-position-execution-marker-line"
                x1={marker().x}
                y1={margin.top}
                x2={marker().x}
                y2={margin.top + ly().plotH}
              />
              <circle
                class="updown-chart-position-execution-marker"
                cx={marker().x}
                cy={marker().y}
                r="4"
              />
            </g>
          )}
        </Show>

        <Show when={props.toggles.showPositionExitPrice && positionExitPriceMarker()}>
          {(marker) => (
            <g>
              <line
                class="updown-chart-position-exit-marker-line"
                x1={marker().x}
                y1={margin.top}
                x2={marker().x}
                y2={margin.top + ly().plotH}
              />
              <line
                class="updown-chart-position-exit-marker-line-h"
                x1={margin.left}
                y1={marker().y}
                x2={margin.left + ly().plotW}
                y2={marker().y}
              />
              <circle
                class="updown-chart-position-exit-marker"
                cx={marker().x}
                cy={marker().y}
                r="4"
              />
            </g>
          )}
        </Show>

        <Show when={props.toggles.showSlExitAttempts}>
          <For each={slExitAttemptMarkers()}>
            {(marker) => {
              const x = xPos(marker.t);
              const levels = props.positionLevels;
              const outcome = levels?.outcome ?? null;
              const y =
                marker.markBid != null
                  ? yPos(
                      bidToDisplayPrice(
                        marker.markBid,
                        props.priceMode,
                        props.points,
                        marker.t,
                        outcome,
                        props.outcomeLabels,
                      ),
                    )
                  : margin.top + 10;
              const label = formatSlAttemptMarkerLabel(marker);
              return (
                <g
                  class="updown-chart-sl-attempt-marker-group"
                  onMouseEnter={() =>
                    setSlAttemptHover({
                      x: x + 8,
                      y: y + 4,
                      label: `${label} · ${formatUpDownChartTime(marker.t, ly().maxT - ly().minT)}`,
                    })
                  }
                  onMouseLeave={() => setSlAttemptHover(null)}
                >
                  <circle
                    class="updown-chart-sl-attempt-marker"
                    cx={x}
                    cy={y}
                    r="3.5"
                  />
                </g>
              );
            }}
          </For>
        </Show>

        <Show when={props.toggles.showPriceGap}>
          <For each={gapIndices()}>
            {(idx) => {
              const p = props.points[idx]!;
              const price = p.up ?? p.down ?? 0.5;
              return (
                <circle
                  class="updown-chart-gap-marker"
                  cx={xPos(p.t)}
                  cy={yPos(price)}
                  r="3"
                />
              );
            }}
          </For>
        </Show>

        <Show when={props.toggles.showPositionLevels && props.positionLevels != null}>
          <PositionLevelLines
            levels={props.positionLevels!}
            yPos={yPos}
            x1={margin.left}
            x2={margin.left + ly().plotW}
            plotTop={margin.top}
            plotBottom={margin.top + ly().plotH}
            points={props.points}
            priceMode={props.priceMode}
            outcomeLabels={props.outcomeLabels}
          />
        </Show>
      </svg>

      <Show when={!markerTooltipActive() ? hovered() : null}>
        {(point) => (
          <Show when={tooltipPos()}>
            {(pos) => (
              <div
                class="updown-chart-tooltip"
                style={{
                  left: `${pos().x}px`,
                  top: `${pos().y}px`,
                }}
              >
                <strong>
                  {Number.isFinite(point().t)
                    ? formatUpDownChartTime(point().t, ly().maxT - ly().minT)
                    : '—'}
                </strong>
                <div>
                  {props.outcomeLabels?.side0 ?? 'Up'}:{' '}
                  {formatUpDownPriceCents(point().up)}
                </div>
                <Show when={point().down != null}>
                  <div>
                    {props.outcomeLabels?.side1 ?? 'Down'}:{' '}
                    {formatUpDownPriceCents(point().down)}
                  </div>
                </Show>
                <Show when={point().metrics}>
                  {(m) => (
                    <>
                      <div class="updown-chart-tooltip-divider" />
                      <Show when={m().downSpreadPct != null}>
                        {/* Mode crypto Up/Down : afficher les deux spreads */}
                        <div>Spread Up: {m().upSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
                        <div>Spread Down: {m().downSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
                        <div>VWAP Up: {formatUpDownPriceCents(m().upAskVwap ?? null)}</div>
                        <div>Liquidité Up: {fmtLiquidityStatus(m().upLiquidityStatus)}</div>
                        <div>Liquidité Down: {fmtLiquidityStatus(m().downLiquidityStatus)}</div>
                        <Show when={m().upDelta1s != null}>
                          <div>Δ Up 1s: {formatUpDownPriceCents(m().upDelta1s)}</div>
                        </Show>
                      </Show>
                      <Show when={m().downSpreadPct == null && m().upSpreadPct != null}>
                        {/* Mode non-crypto : affichage simplifié */}
                        <div>Spread: {m().upSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
                        <Show when={m().upLastTradePrice != null}>
                          <div>Dernier échange: {formatUpDownPriceCents(m().upLastTradePrice)}</div>
                        </Show>
                      </Show>
                      <Show when={m().lastSignalOutcome}>
                        <div>
                          Signal: {m().lastSignalOutcome} (
                          {((m().lastSignalConfidence ?? 0) * 100).toFixed(0)}%)
                          <Show
                            when={
                              m().signalAgeMs != null &&
                              m().signalAgeMs! >= 0 &&
                              m().signalAgeMs! < SIGNAL_MARKER_MAX_AGE_MS
                            }
                          >
                            {' '}
                            · récent
                          </Show>
                        </div>
                      </Show>
                      <Show when={m().priceGap != null}>
                        <div>
                          Gap: {((m().priceGap ?? 0) * 100).toFixed(1)}¢
                          <Show when={(m().priceGap ?? 0) > PRICE_GAP_MARKER_THRESHOLD}> · élevé</Show>
                        </div>
                      </Show>
                      <Show when={m().upBid != null && m().upAsk != null}>
                        <div>
                          Bid/Ask {props.outcomeLabels?.side0 ?? 'Up'}:{' '}
                          {formatUpDownPriceCents(m().upBid)} /{' '}
                          {formatUpDownPriceCents(m().upAsk)}
                        </div>
                      </Show>
                      <Show when={m().downBid != null && m().downAsk != null}>
                        <div>
                          Bid/Ask {props.outcomeLabels?.side1 ?? 'Down'}:{' '}
                          {formatUpDownPriceCents(m().downBid)} /{' '}
                          {formatUpDownPriceCents(m().downAsk)}
                        </div>
                      </Show>
                    </>
                  )}
                </Show>
              </div>
            )}
          </Show>
        )}
      </Show>

      <Show when={slAttemptHover()}>
        {(hover) => (
          <div
            class="updown-chart-tooltip updown-chart-sl-attempt-tooltip"
            style={{
              left: `${hover().x}px`,
              top: `${hover().y}px`,
            }}
          >
            {hover().label}
          </div>
        )}
      </Show>

      <Show when={signalHover()}>
        {(hover) => (
          <div
            class="updown-chart-tooltip updown-chart-signal-tooltip"
            style={{
              left: `${hover().x}px`,
              top: `${hover().y}px`,
            }}
          >
            {hover().label}
          </div>
        )}
      </Show>
    </>
  );
}

export function UpDownPriceChart(props: UpDownPriceChartProps) {
  const [wrapEl, setWrapEl] = createSignal<HTMLDivElement>();
  const measuredWidth = useChartWidth(wrapEl);
  const [hoverIndex, setHoverIndex] = createSignal<number | null>(null);
  const [toggles, setToggles] = createSignal<ChartOverlayToggles>({
    ...DEFAULT_OVERLAY_TOGGLES,
  });
  const [priceMode, setPriceMode] = createSignal<PriceMode>('mid');

  const metricsAvailable = createMemo(() => hasChartMetrics(props.points));
  const hasDownData = createMemo(() => props.points.some((p) => p.down != null));
  const hasExitPrice = createMemo(() => {
    const levels = props.positionLevels;
    return (
      levels?.exitBidVwap != null &&
      levels.exitBidVwap > 0 &&
      levels?.closedAtMs != null &&
      Number.isFinite(levels.closedAtMs)
    );
  });
  const hasSlExitAttempts = createMemo(() =>
    (props.exitAttempts ?? []).some((e) => e.closeReason === 'SL'),
  );

  const activeMetrics = createMemo(() => {
    const idx = hoverIndex();
    const point =
      idx != null
        ? props.points[idx]
        : props.points[props.points.length - 1];
    return point?.metrics;
  });

  const layout = createMemo(() =>
    computeUpDownPlotLayout(props.points, {
      width: props.width ?? measuredWidth(),
      height: props.height,
      priceMode: priceMode(),
    }),
  );

  const setHover = (index: number | null) => {
    setHoverIndex(index);
    const point = index != null ? props.points[index] ?? null : null;
    props.onHoverPointChange?.(point);
  };

  const toggleOverlay = (key: keyof ChartOverlayToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const side0Label = () => props.outcomeLabels?.side0 ?? 'Up';
  const side1Label = () => props.outcomeLabels?.side1 ?? 'Down';

  return (
    <Show when={layout()} fallback={<p class="market-chart-state">{EMPTY_STATE}</p>}>
      {(ly) => (
        <div
          class="updown-chart-wrap"
          ref={setWrapEl}
          onMouseLeave={() => {
            setHover(null);
            setSignalHover(null);
            setSlAttemptHover(null);
          }}
        >
          <UpDownChartLegend
            toggles={toggles()}
            onToggle={toggleOverlay}
            metricsAvailable={metricsAvailable()}
            activeMetrics={activeMetrics}
            hasPositionLevels={props.positionLevels != null}
            hasExitPrice={hasExitPrice()}
            hasSlExitAttempts={hasSlExitAttempts()}
            hasDownData={hasDownData()}
            side0Label={side0Label()}
            side1Label={side1Label()}
            priceMode={priceMode()}
            onPriceModeChange={setPriceMode}
          />
          <UpDownChartSvg
            layout={ly()}
            points={props.points}
            marketStartMs={props.marketStartMs}
            marketEndMs={props.marketEndMs}
            toggles={toggles()}
            hoverIndex={hoverIndex}
            onHoverIndex={setHover}
            positionLevels={props.positionLevels}
            priceMode={priceMode()}
            exitAttempts={props.exitAttempts}
            outcomeLabels={props.outcomeLabels}
            conditionId={props.conditionId}
            executions={props.executions}
            maxSlippagePercent={props.maxSlippagePercent}
          />
          <UpDownChartMarkerLegend
            marketStartMs={props.marketStartMs}
            marketEndMs={props.marketEndMs}
          />
        </div>
      )}
    </Show>
  );
}
