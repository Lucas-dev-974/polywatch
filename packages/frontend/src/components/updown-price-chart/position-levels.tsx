import { For } from 'solid-js';
import type { UpDownPricePoint, OutcomeSideLabels } from '../../lib/market-chart';
import {
  computePositionLevelThresholds,
  bidToDisplayPrice,
  resolveLevelLabelYs,
  formatUpDownPriceCents,
  type PriceMode,
} from '../../lib/updown-price-chart';
import type { PositionLevels } from './types';

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

export function PositionLevelLines(props: {
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
  const labelYs = resolveLevelLabelYs(lineYs, 18).map((y) =>
    Math.min(Math.max(y, plotTop + 10), plotBottom - 10),
  );
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
