import { For, Show, createMemo, createSignal, createUniqueId, type Accessor } from 'solid-js';
import type { BacktestEquityPointDto, BacktestExcludedTickDto } from '../api';
import { useChartWidth } from '../hooks/useChartWidth';
import { formatAdaptiveAmount } from '../lib/position';
import {
  CHART_CONFIG,
  type PlotLayout,
  type Point,
  areaPath,
  computeLayout,
  extremeIndices,
  xPos,
  yPos,
} from '../lib/equity-chart';

interface BacktestEquityChartProps {
  points: BacktestEquityPointDto[];
  excludedTicks?: BacktestExcludedTickDto[];
  capital: number;
}

/** Converti une polyligne en courbe lissée (Bézier catmull-rom → cubic). */
function smoothPath(layout: PlotLayout): string {
  const pts = layout.points.map((p) => ({ x: xPos(layout, p.t), y: yPos(layout, p.equity) }));
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;

  const d = [`M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
  }
  return d.join(' ');
}

function formatAxis(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return formatAdaptiveAmount(value);
}

function ChartSvg(props: {
  layout: PlotLayout;
  ids: { fill: string; line: string; glow: string };
  capital: number;
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
  showBasePoints: Accessor<boolean>;
  excludedTicks: Accessor<number[]>;
  showExcluded: Accessor<boolean>;
}) {
  const extremes = createMemo(() => extremeIndices(props.layout.points));
  const capitalY = () => yPos(props.layout, props.capital);
  const hoverPoint = () =>
    props.hoverIdx != null && props.hoverIdx < props.layout.points.length
      ? props.layout.points[props.hoverIdx]!
      : null;
  const visibleExcluded = () =>
    props.showExcluded()
      ? props.excludedTicks().filter(
          (t) => t >= props.layout.minT && t <= props.layout.maxT,
        )
      : [];

  return (
    <svg
      class="backtest-equity-chart-svg"
      viewBox={`0 0 ${props.layout.width} ${CHART_CONFIG.height}`}
      width="100%"
      height={CHART_CONFIG.height}
      role="img"
      aria-label="Courbe d’equity du backtest"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={props.ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent, #4f8cff)" stop-opacity="0.35" />
          <stop offset="60%" stop-color="var(--accent, #4f8cff)" stop-opacity="0.08" />
          <stop offset="100%" stop-color="var(--accent, #4f8cff)" stop-opacity="0" />
        </linearGradient>
        <linearGradient id={props.ids.line} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--accent, #4f8cff)" stop-opacity="0.7" />
          <stop offset="55%" stop-color="var(--accent, #4f8cff)" />
          <stop offset="100%" stop-color="#34d399" />
        </linearGradient>
        <filter id={props.ids.glow} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grille horizontale + labels axe Y */}
      <For each={props.layout.yTicks}>
        {(tick) => {
          const y = yPos(props.layout, tick);
          return (
            <g class="backtest-chart-grid-y">
              <line x1={CHART_CONFIG.margin.left} y1={y} x2={CHART_CONFIG.margin.left + props.layout.plotW} y2={y} />
              <text x={CHART_CONFIG.margin.left - 8} y={y} text-anchor="end" dominant-baseline="middle" class="backtest-chart-axis-y">
                {formatAxis(tick)}
              </text>
            </g>
          );
        }}
      </For>

      {/* Repère vertical du capital initial */}
      <line
        class="backtest-chart-capital-line"
        x1={CHART_CONFIG.margin.left}
        y1={capitalY()}
        x2={CHART_CONFIG.margin.left + props.layout.plotW}
        y2={capitalY()}
      />
      <text
        class="backtest-chart-capital-label"
        x={CHART_CONFIG.margin.left + props.layout.plotW - 4}
        y={capitalY() - 4}
        text-anchor="end"
      >
        capital {formatAxis(props.capital)}
      </text>

      {/* Aire + courbe */}
      <path d={areaPath(props.layout)} fill={`url(#${props.ids.fill})`} />
      <path
        d={smoothPath(props.layout)}
        fill="none"
        stroke={`url(#${props.ids.line})`}
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter={`url(#${props.ids.glow})`}
      />

      {/* Lignes verticales des ticks exclus (orange) */}
      <Show when={visibleExcluded().length > 0}>
        <For each={visibleExcluded()}>
          {(t) => {
            const x = xPos(props.layout, t);
            return (
              <line
                class="backtest-chart-excluded-line"
                x1={x}
                y1={CHART_CONFIG.margin.top}
                x2={x}
                y2={CHART_CONFIG.margin.top + props.layout.plotH}
              />
            );
          }}
        </For>
      </Show>

      {/* Ligne de visée + point du survol */}
      <Show when={hoverPoint()}>
        {(hp) => {
          const hx = () => xPos(props.layout, hp().t);
          const hy = () => yPos(props.layout, hp().equity);
          return (
            <g class="backtest-chart-hover">
              <line
                x1={hx()}
                y1={CHART_CONFIG.margin.top}
                x2={hx()}
                y2={CHART_CONFIG.margin.top + props.layout.plotH}
              />
              <g class="backtest-chart-hover-dot">
                <circle cx={hx()} cy={hy()} r="5" />
                <circle cx={hx()} cy={hy()} r="2.5" />
              </g>
            </g>
          );
        }}
      </Show>

      {/* Points extrêmes + dernier */}
      <For each={props.layout.points}>
        {(pt, i) => {
          const isExtreme = () => {
            const ex = extremes();
            return ex.minIdx === i() || ex.maxIdx === i();
          };
          const isLast = () => i() === props.layout.points.length - 1;
          return (
            <circle
              cx={xPos(props.layout, pt.t)}
              cy={yPos(props.layout, pt.equity)}
              r={isLast() ? 5 : isExtreme() ? 3.5 : 2}
              class={isLast() ? 'backtest-chart-point-last' : isExtreme() ? 'backtest-chart-point-extreme' : 'backtest-chart-point'}
              style={!isLast() ? { opacity: props.showBasePoints() ? 1 : 0 } : undefined}
            />
          );
        }}
      </For>

      {/* Axe X */}
      <For each={props.layout.xTicks}>
        {(tick) => {
          const x = xPos(props.layout, tick.t);
          return (
            <text x={x} y={CHART_CONFIG.height - 8} text-anchor="middle" class="backtest-chart-axis-x">
              {tick.label}
            </text>
          );
        }}
      </For>

      {/* Cible hover (tooltip) */}
      <rect
        class="backtest-chart-hitarea"
        x={CHART_CONFIG.margin.left}
        y={CHART_CONFIG.margin.top}
        width={props.layout.plotW}
        height={props.layout.plotH}
        onMouseMove={(e) => {
          const el = e.currentTarget as SVGRectElement;
          const rect = el.getBoundingClientRect();
          const rel = e.clientX - rect.left;
          const scale = props.layout.plotW / rect.width;
          const x = CHART_CONFIG.margin.left + rel * scale;
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < props.layout.points.length; i++) {
            const px = xPos(props.layout, props.layout.points[i]!.t);
            const dist = Math.abs(px - x);
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          }
          props.onHover(best);
        }}
        onMouseLeave={() => props.onHover(null)}
      />
    </svg>
  );
}

export function BacktestEquityChart(props: BacktestEquityChartProps) {
  const [wrapEl, setWrapEl] = createSignal<HTMLDivElement>();
  const width = useChartWidth(wrapEl);
  const [hoverIdx, setHoverIdx] = createSignal<number | null>(null);
  const [showBasePoints, setShowBasePoints] = createSignal(true);
  const [showExcludedTicks, setShowExcludedTicks] = createSignal(true);
  const instanceId = createUniqueId();

  const points = createMemo(() =>
    [...props.points]
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .map((p) => ({ t: Date.parse(p.t), equity: p.equity })),
  );

  const excludedTs = createMemo(() =>
    (props.excludedTicks ?? [])
      .map((e) => Date.parse(e.t))
      .filter((n) => Number.isFinite(n)),
  );

  const layout = createMemo(() => computeLayout(points(), width()));

  const ids = {
    fill: `${instanceId}-fill`,
    line: `${instanceId}-line`,
    glow: `${instanceId}-glow`,
  };

  const last = () => (points().length > 0 ? points()[points().length - 1]! : null);
  const first = () => (points().length > 0 ? points()[0]! : null);
  const pnl = () => {
    const l = last();
    const f = first();
    if (!l || !f) return null;
    return l.equity - f.equity;
  };
  const pnlPct = () => {
    const f = first();
    const p = pnl();
    if (!f || p == null || f.equity === 0) return null;
    return (p / Math.abs(f.equity)) * 100;
  };

  return (
    <div class="backtest-equity-chart">
      <div class="backtest-equity-chart-header">
        <span class="backtest-equity-chart-title">Courbe d’equity</span>
        <div class="backtest-equity-chart-header-right">
          <label class="backtest-equity-chart-toggle">
            <input
              type="checkbox"
              checked={showBasePoints()}
              onChange={(e) => setShowBasePoints(e.currentTarget.checked)}
            />
            <span>Points</span>
          </label>
          <label class="backtest-equity-chart-toggle">
            <input
              type="checkbox"
              checked={showExcludedTicks()}
              onChange={(e) => setShowExcludedTicks(e.currentTarget.checked)}
            />
            <span>Ticks exclus</span>
          </label>
          <Show when={pnl() != null}>
            <span class="backtest-equity-chart-range mono">
              {formatAxis(points()[0]!.equity)} → {formatAxis(last()!.equity)}
              <Show when={pnlPct() != null}>
                <span class={pnl()! >= 0 ? 'backtest-pnl-pos' : 'backtest-pnl-neg'}>
                  {' '}({pnl()! >= 0 ? '+' : ''}{formatAdaptiveAmount(pnl()!)}, {pnlPct()! >= 0 ? '+' : ''}
                  {pnlPct()!.toFixed(1)}%)
                </span>
              </Show>
            </span>
          </Show>
        </div>
      </div>

      <div class="backtest-equity-chart-wrap" ref={setWrapEl}>
        <Show
          when={layout()}
          fallback={
            <p class="form-hint backtest-equity-chart-hint">
              {points().length < 2 ? 'Au moins 2 points pour afficher la courbe.' : 'Chargement…'}
            </p>
          }
        >
          {(plot) => (
            <ChartSvg
              layout={plot()}
              ids={ids}
              capital={props.capital}
              hoverIdx={hoverIdx()}
              onHover={setHoverIdx}
              showBasePoints={showBasePoints}
              excludedTicks={excludedTs}
              showExcluded={showExcludedTicks}
            />
          )}
        </Show>
      </div>

      <Show when={last()}>
        <div class="backtest-chart-summary">
          <span>
            Equity finale <strong>{formatAxis(last()!.equity)}</strong>
          </span>
          <Show when={pnl() != null}>
            <span>
              P&L <strong class={pnl()! >= 0 ? 'backtest-pnl-pos' : 'backtest-pnl-neg'}>{pnl()! >= 0 ? '+' : ''}{formatAxis(pnl()!)}</strong>
            </span>
          </Show>
          <span>
            Cash <strong>{formatAxis(props.points[props.points.length - 1]?.cash ?? last()!.equity)}</strong>
          </span>
        </div>
      </Show>
    </div>
  );
}
