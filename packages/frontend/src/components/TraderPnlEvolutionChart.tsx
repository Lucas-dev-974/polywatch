import { createMemo } from 'solid-js';
import { formatPusdAmount } from '../lib/position';
import type { TraderPnlSeriesPoint } from '../lib/trader-analytics';
import type { Point } from '../lib/equity-chart';
import { TimeSeriesLineChart, type TimeSeriesChartTone } from './TimeSeriesLineChart';

interface Props {
  points: TraderPnlSeriesPoint[];
  loading?: boolean;
  hint?: string | null;
}

function buildPnlPoints(items: TraderPnlSeriesPoint[]): Point[] {
  return [...items]
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    .map((p) => ({
      t: new Date(p.t).getTime(),
      equity: p.pnl,
    }));
}

export function TraderPnlEvolutionChart(props: Props) {
  const chartPoints = createMemo(() => buildPnlPoints(props.points));
  const tone = createMemo((): TimeSeriesChartTone => {
    const finalPnl = props.points[props.points.length - 1]?.pnl ?? 0;
    return finalPnl >= 0 ? 'positive' : 'negative';
  });

  return (
    <TimeSeriesLineChart
      class="sim-analytics-pnl-chart"
      points={chartPoints()}
      title="Évolution PnL"
      ariaLabel="Évolution du PnL dans le temps"
      tone={tone()}
      rangeSuffix="pUSD"
      formatY={formatPusdAmount}
      baselineAtZero
      loading={props.loading}
      hint={props.hint}
      emptyHint="Aucun snapshot — activez les snapshots auto ou créez-en un manuellement."
    />
  );
}
