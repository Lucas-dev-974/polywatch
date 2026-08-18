import { buildChartXTicks } from '../../lib/updown-price-chart';

export const CHART_H = 220;
export const CHART_MARGIN = { top: 12, right: 16, bottom: 26, left: 44 };
export const Y_TICKS = Array.from({ length: 7 }, (_, i) => i * 0.15);

export interface ChartScale {
  minT: number;
  maxT: number;
  plotW: number;
  plotH: number;
  spanT: number;
  xPos: (t: number) => number;
  yPos: (p: number) => number;
}

/** Construit l'échelle du graph à partir de la largeur et des bornes temporelles. */
export function buildChartScale(
  width: number,
  minT: number,
  maxT: number,
): ChartScale {
  const plotW = Math.max(0, width - CHART_MARGIN.left - CHART_MARGIN.right);
  const plotH = Math.max(0, CHART_H - CHART_MARGIN.top - CHART_MARGIN.bottom);
  const spanT = maxT - minT || 1;
  return {
    minT,
    maxT,
    plotW,
    plotH,
    spanT,
    xPos: (t) => CHART_MARGIN.left + ((t - minT) / spanT) * plotW,
    yPos: (p) => CHART_MARGIN.top + (1 - p) * plotH,
  };
}

export function buildXTicks(minT: number, maxT: number, plotW: number) {
  return buildChartXTicks(minT, maxT, undefined, plotW);
}
