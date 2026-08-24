import { createMemo, createSignal, For, Show } from 'solid-js';
import type { UpDownPricePoint, OutcomeSideLabels } from '../../lib/market-chart';
import {
  UPDOWN_CHART_CONFIG,
  findNearestPointIndex,
  formatUpDownChartTime,
  formatUpDownPriceCents,
  bidToDisplayPrice,
  xPosFromTime,
  yPosFromPrice,
  type UpDownPlotLayout,
  type PriceMode,
} from '../../lib/updown-price-chart';
import {
  buildBidAskBandGeometry,
  buildSlExitAttemptMarkers,
  findIlliquidIndices,
  findPartialLiquidityIndices,
  findPriceGapIndices,
  findSignalMarkerIndices,
  resolveSignalExecutionStatus,
  type ChartOverlayToggles,
} from '../../lib/updown-chart-overlays';
import { fmtLiquidityStatus } from '../../lib/market-chart-debug-format';
import { formatSlAttemptMarkerLabel } from '../../lib/exit-attempts';
import { SIGNAL_MARKER_MAX_AGE_MS, PRICE_GAP_MARKER_THRESHOLD } from '../../lib/updown-chart-overlays';
import type { ExitAttemptEvent } from '../../lib/exit-attempts';
import type { Execution } from '../../lib/execution';
import type { PositionLevels } from './types';
import { PositionLevelLines } from './position-levels';
import { signalMarkerClass, formatSignalMarkerLabel } from './markers';

interface UpDownChartSvgProps {
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
  conditionId?: string | null;
  executions?: Execution[];
  maxSlippagePercent?: number | null;
}

export function UpDownChartSvg(props: UpDownChartSvgProps) {
  const margin = UPDOWN_CHART_CONFIG.margin;
  const { up, down } = UPDOWN_CHART_CONFIG.colors;
  const ly = () => props.layout;
  const [tooltipPos, setTooltipPos] = createSignal<{ x: number; y: number } | null>(null);
  const [hoverLineX, setHoverLineX] = createSignal<number | null>(null);

  const xPos = (t: number) => xPosFromTime(t, ly().minT, ly().maxT, ly().plotW, margin.left);
  const yPos = (price: number) => yPosFromPrice(price, ly().plotH, margin.top);

  const hovered = () => {
    const idx = props.hoverIndex();
    return idx !== null ? props.points[idx] : null;
  };

  const upBandGeometry = createMemo(() =>
    buildBidAskBandGeometry(props.points, 'up', ly().minT, ly().maxT, ly().plotW, ly().plotH, margin.top, margin.left),
  );
  const downBandGeometry = createMemo(() =>
    buildBidAskBandGeometry(props.points, 'down', ly().minT, ly().maxT, ly().plotW, ly().plotH, margin.top, margin.left),
  );

  const signalIndices = createMemo(() => findSignalMarkerIndices(props.points));
  const gapIndices = createMemo(() => findPriceGapIndices(props.points));
  const illiquidIndices = createMemo(() => findIlliquidIndices(props.points));
  const partialLiquidityIndices = createMemo(() => findPartialLiquidityIndices(props.points));

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
    return { x: xPos(openedAtMs), y: yPos(entryPrice) };
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
    return { x: xPos(closedAtMs), y: yPos(exitBidVwap) };
  });

  const slExitAttemptMarkers = createMemo(() =>
    buildSlExitAttemptMarkers(props.exitAttempts ?? [], ly().minT, ly().maxT),
  );

  const [slAttemptHover, setSlAttemptHover] = createSignal<{ x: number; y: number; label: string } | null>(null);
  const [signalHover, setSignalHover] = createSignal<{ x: number; y: number; label: string } | null>(null);

  const markerTooltipActive = () => Boolean(slAttemptHover() || signalHover());

  const handleMouseMove = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const wrap = svg.closest('.updown-chart-wrap');
    if (wrap) {
      const wrapRect = wrap.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - wrapRect.left + 12, y: e.clientY - wrapRect.top + 12 });
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
            {(d) => <path d={d} class="updown-chart-band-edge updown-chart-band-edge-up" />}
          </For>
          <For each={upBandGeometry().bidEdges}>
            {(d) => <path d={d} class="updown-chart-band-edge updown-chart-band-edge-up" />}
          </For>
        </Show>
        <Show when={props.toggles.showBidAskBands && downBandGeometry().fills.length > 0}>
          <For each={downBandGeometry().fills}>
            {(d) => <path d={d} class="updown-chart-band updown-chart-band-down" />}
          </For>
          <For each={downBandGeometry().askEdges}>
            {(d) => <path d={d} class="updown-chart-band-edge updown-chart-band-edge-down" />}
          </For>
          <For each={downBandGeometry().bidEdges}>
            {(d) => <path d={d} class="updown-chart-band-edge updown-chart-band-edge-down" />}
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
                resolveSignalExecutionStatus(p, props.conditionId ?? '', props.executions ?? [], Date.now());
              const markerClass = () => signalMarkerClass(status());
              return (
                <g
                  class="updown-chart-signal-hit"
                  onMouseEnter={(e) => {
                    const wrap = (e.currentTarget as SVGGElement).closest('.updown-chart-wrap');
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
                  <circle class="updown-chart-signal-hitarea" cx={cx} cy={markerY - 4} r="10" />
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
              <circle class="updown-chart-position-execution-marker" cx={marker().x} cy={marker().y} r="4" />
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
              <circle class="updown-chart-position-exit-marker" cx={marker().x} cy={marker().y} r="4" />
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
                  <circle class="updown-chart-sl-attempt-marker" cx={x} cy={y} r="3.5" />
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
                <circle class="updown-chart-gap-marker" cx={xPos(p.t)} cy={yPos(price)} r="3" />
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
                style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
              >
                <strong>
                  {Number.isFinite(point().t) ? formatUpDownChartTime(point().t, ly().maxT - ly().minT) : '—'}
                </strong>
                <div>
                  {props.outcomeLabels?.side0 ?? 'Up'}: {formatUpDownPriceCents(point().up)}
                </div>
                <Show when={point().down != null}>
                  <div>
                    {props.outcomeLabels?.side1 ?? 'Down'}: {formatUpDownPriceCents(point().down)}
                  </div>
                </Show>
                <Show when={point().metrics}>
                  {(m) => (
                    <>
                      <div class="updown-chart-tooltip-divider" />
                      <Show when={m().downSpreadPct != null}>
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
                        <div>Spread: {m().upSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
                        <Show when={m().upLastTradePrice != null}>
                          <div>Dernier échange: {formatUpDownPriceCents(m().upLastTradePrice)}</div>
                        </Show>
                      </Show>
                      <Show when={m().lastSignalOutcome}>
                        <div>
                          Signal: {m().lastSignalOutcome} ({((m().lastSignalConfidence ?? 0) * 100).toFixed(0)}%)
                          <Show when={m().signalAgeMs != null && m().signalAgeMs! >= 0 && m().signalAgeMs! < SIGNAL_MARKER_MAX_AGE_MS}>
                            {' '}· récent
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
                          Bid/Ask {props.outcomeLabels?.side0 ?? 'Up'}: {formatUpDownPriceCents(m().upBid)} /{' '}
                          {formatUpDownPriceCents(m().upAsk)}
                        </div>
                      </Show>
                      <Show when={m().downBid != null && m().downAsk != null}>
                        <div>
                          Bid/Ask {props.outcomeLabels?.side1 ?? 'Down'}: {formatUpDownPriceCents(m().downBid)} /{' '}
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
            style={{ left: `${hover().x}px`, top: `${hover().y}px` }}
          >
            {hover().label}
          </div>
        )}
      </Show>

      <Show when={signalHover()}>
        {(hover) => (
          <div
            class="updown-chart-tooltip updown-chart-signal-tooltip"
            style={{ left: `${hover().x}px`, top: `${hover().y}px` }}
          >
            {hover().label}
          </div>
        )}
      </Show>
    </>
  );
}
