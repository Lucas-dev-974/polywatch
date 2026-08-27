import {
  For,
  Show,
  createMemo,
  createSignal,
  createUniqueId,
} from 'solid-js';
import { formatAdaptiveAmount } from '../../lib/position';
import {
  CHART_CONFIG,
  type PlotLayout,
  type Point,
  areaPath,
  computeLayout,
  extremeIndices,
  linePath,
  xPos,
  yPos,
} from '../../lib/equity-chart';
import { useChartWidth } from '../../hooks/useChartWidth';

export type TimeSeriesChartTone = 'sim' | 'positive' | 'negative';

interface ChartTheme {
  fillTop: string;
  fillMid: string;
  fillBottom: string;
  lineStart: string;
  lineMid: string;
  lineEnd: string;
}

const CHART_THEMES: Record<TimeSeriesChartTone, ChartTheme> = {
  sim: {
    fillTop: 'var(--sim)',
    fillMid: 'var(--sim)',
    fillBottom: 'var(--sim)',
    lineStart: '#34d399',
    lineMid: 'var(--sim)',
    lineEnd: '#059669',
  },
  positive: {
    fillTop: 'var(--success)',
    fillMid: 'var(--success)',
    fillBottom: 'var(--success)',
    lineStart: '#4ade80',
    lineMid: 'var(--success)',
    lineEnd: '#16a34a',
  },
  negative: {
    fillTop: 'var(--danger)',
    fillMid: 'var(--danger)',
    fillBottom: 'var(--danger)',
    lineStart: '#f87171',
    lineMid: 'var(--danger)',
    lineEnd: '#dc2626',
  },
};

export interface TimeSeriesLineChartProps {
  points: Point[];
  title: string;
  ariaLabel: string;
  tone: TimeSeriesChartTone;
  rangeSuffix?: string;
  formatY?: (value: number) => string;
  baselineAtZero?: boolean;
  loading?: boolean;
  hint?: string | null;
  emptyHint?: string;
  class?: string;
}

function ChartSvg(props: {
  layout: PlotLayout;
  ids: { fill: string; line: string; glow: string };
  theme: ChartTheme;
  ariaLabel: string;
  formatY?: (value: number) => string;
}) {
  const extremes = createMemo(() => extremeIndices(props.layout.points));

  return (
    <svg
      class="sim-snapshot-chart-svg"
      viewBox={`0 0 ${props.layout.width} ${CHART_CONFIG.height}`}
      width="100%"
      height={CHART_CONFIG.height}
      role="img"
      aria-label={props.ariaLabel}
    >
      <defs>
        <linearGradient id={props.ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={props.theme.fillTop} stop-opacity="0.45" />
          <stop offset="60%" stop-color={props.theme.fillMid} stop-opacity="0.12" />
          <stop offset="100%" stop-color={props.theme.fillBottom} stop-opacity="0" />
        </linearGradient>

        <linearGradient id={props.ids.line} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color={props.theme.lineStart} />
          <stop offset="50%" stop-color={props.theme.lineMid} />
          <stop offset="100%" stop-color={props.theme.lineEnd} />
        </linearGradient>

        <filter
          id={props.ids.glow}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <For each={props.layout.yTicks}>
        {(tick) => {
          const y = yPos(props.layout, tick);
          return (
            <g class="sim-snapshot-chart-grid-y">
              <line
                x1={CHART_CONFIG.margin.left}
                y1={y}
                x2={CHART_CONFIG.margin.left + props.layout.plotW}
                y2={y}
              />
              <text
                x={CHART_CONFIG.margin.left - 8}
                y={y}
                text-anchor="end"
                dominant-baseline="middle"
                class="sim-snapshot-chart-axis-y"
              >
                {props.formatY ? props.formatY(tick) : formatAdaptiveAmount(tick)}
              </text>
            </g>
          );
        }}
      </For>

      <For each={props.layout.xTicks}>
        {(tick) => {
          const x = xPos(props.layout, tick.t);
          return (
            <line
              class="sim-snapshot-chart-grid-x"
              x1={x}
              y1={CHART_CONFIG.margin.top}
              x2={x}
              y2={CHART_CONFIG.margin.top + props.layout.plotH}
            />
          );
        }}
      </For>

      <rect
        class="sim-snapshot-chart-frame"
        x={CHART_CONFIG.margin.left}
        y={CHART_CONFIG.margin.top}
        width={props.layout.plotW}
        height={props.layout.plotH}
        rx="4"
      />

      <path d={areaPath(props.layout)} fill={`url(#${props.ids.fill})`} />
      <path
        d={linePath(props.layout)}
        fill="none"
        stroke={`url(#${props.ids.line})`}
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter={`url(#${props.ids.glow})`}
      />

      <For each={props.layout.points}>
        {(pt, i) => {
          const isExtreme = () => {
            const ex = extremes();
            return ex.minIdx === i() || ex.maxIdx === i();
          };
          return (
            <circle
              cx={xPos(props.layout, pt.t)}
              cy={yPos(props.layout, pt.equity)}
              r={isExtreme() ? 4 : 2.5}
              class={
                isExtreme()
                  ? 'sim-snapshot-chart-point-active'
                  : 'sim-snapshot-chart-point-base'
              }
            />
          );
        }}
      </For>

      <For each={props.layout.xTicks}>
        {(tick) => {
          const x = xPos(props.layout, tick.t);
          return (
            <text
              x={x}
              y={CHART_CONFIG.height - 10}
              text-anchor="middle"
              class="sim-snapshot-chart-axis-x"
            >
              {tick.label}
            </text>
          );
        }}
      </For>
    </svg>
  );
}

export function TimeSeriesLineChart(props: TimeSeriesLineChartProps) {
  const [wrapEl, setWrapEl] = createSignal<HTMLDivElement>();
  const width = useChartWidth(wrapEl);
  const layout = createMemo(() =>
    computeLayout(props.points, width(), { baselineAtZero: props.baselineAtZero }),
  );
  const instanceId = createUniqueId();
  const theme = () => CHART_THEMES[props.tone];

  const ids = {
    fill: `${instanceId}-fill`,
    line: `${instanceId}-line`,
    glow: `${instanceId}-glow`,
  };

  const rangeLabel = () => {
    if (props.points.length < 2) return null;
    const min = Math.min(...props.points.map((p) => p.equity));
    const max = Math.max(...props.points.map((p) => p.equity));
    const suffix = props.rangeSuffix ?? 'pUSD';
    const fmt = props.formatY ?? formatAdaptiveAmount;
    return `${fmt(min)} – ${fmt(max)} ${suffix}`;
  };

  const fallbackHint = () => {
    if (props.hint) return props.hint;
    if (props.emptyHint) return props.emptyHint;
    return 'Au moins 2 points pour afficher la courbe.';
  };

  return (
    <div class={`sim-snapshot-chart ${props.class ?? ''}`.trim()}>
      <div class="sim-snapshot-chart-header">
        <span class="sim-snapshot-chart-title">{props.title}</span>
        <Show when={rangeLabel()}>
          {(label) => (
            <span class="sim-snapshot-chart-range mono">{label()}</span>
          )}
        </Show>
      </div>
      <div class="sim-snapshot-chart-wrap" ref={setWrapEl}>
        <Show
          when={layout()}
          fallback={
            <p class="form-hint sim-snapshot-chart-hint">
              {props.loading && props.points.length === 0
                ? 'Chargement…'
                : fallbackHint()}
            </p>
          }
        >
          {(plot) => (
            <ChartSvg
              layout={plot()}
              ids={ids}
              theme={theme()}
              ariaLabel={props.ariaLabel}
              formatY={props.formatY}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
