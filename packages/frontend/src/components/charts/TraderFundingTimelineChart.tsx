import { createMemo } from 'solid-js';
import type { TraderFundingTimelinePoint } from '../../lib/trader-insight';
import type { Point } from '../../lib/equity-chart';
import { TimeSeriesLineChart, type TimeSeriesChartTone } from './TimeSeriesLineChart';

interface Props {
  points: TraderFundingTimelinePoint[];
  loading?: boolean;
  hint?: string | null;
}

function buildFundingPoints(items: TraderFundingTimelinePoint[]): Point[] {
  return [...items]
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    .map((p) => ({
      t: new Date(p.t).getTime(),
      equity: p.cumulativeNetUsdc,
    }));
}

export function TraderFundingTimelineChart(props: Props) {
  const chartPoints = createMemo(() => buildFundingPoints(props.points));
  const tone = createMemo((): TimeSeriesChartTone => {
    const last = props.points[props.points.length - 1]?.cumulativeNetUsdc ?? 0;
    return last >= 0 ? 'positive' : 'negative';
  });

  return (
    <TimeSeriesLineChart
      class="sim-analytics-pnl-chart trader-funding-chart"
      points={chartPoints()}
      title="Net injecté cumulé"
      ariaLabel="Évolution du net injecté on-chain dans le temps"
      tone={tone()}
      loading={props.loading}
      hint={props.hint}
      emptyHint="Aucun dépôt ou retrait externe détecté on-chain."
    />
  );
}
