import { createMemo, createSignal, Show } from 'solid-js';
import { useChartWidth } from '../hooks/useChartWidth';
import type { UpDownPricePoint, OutcomeSideLabels, AlgoPriceTickMetrics } from '../lib/market-chart';
import {
  DEFAULT_OVERLAY_TOGGLES,
  hasChartMetrics,
  type ChartOverlayToggles,
} from '../lib/updown-chart-overlays';
import { computeUpDownPlotLayout, type PriceMode } from '../lib/updown-price-chart';
import type { ExitAttemptEvent } from '../lib/exit-attempts';
import type { Execution } from '../lib/execution';
import { UpDownChartLegend } from './updown-price-chart/legend';
import { UpDownChartMarkerLegend } from './updown-price-chart/marker-legend';
import { UpDownChartSvg } from './updown-price-chart/svg';
import type { PositionLevels } from './updown-price-chart/types';

export type { UpDownPricePoint, PositionLevels };

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
    return point?.metrics as AlgoPriceTickMetrics | undefined;
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
