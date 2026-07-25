import { createMemo } from 'solid-js';
import type { TraderCapitalSeriesPoint } from '../lib/trader-insight';
import type { Point } from '../lib/equity-chart';
import { TimeSeriesLineChart, type TimeSeriesChartTone } from './TimeSeriesLineChart';

interface Props {
  points: TraderCapitalSeriesPoint[];
  loading?: boolean;
  hint?: string | null;
}

function buildCapitalPoints(items: TraderCapitalSeriesPoint[]): Point[] {
  return [...items]
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    .map((p) => ({
      t: new Date(p.t).getTime(),
      equity: p.value,
    }));
}

export function TraderCapitalEvolutionChart(props: Props) {
  const chartPoints = createMemo(() => buildCapitalPoints(props.points));
  const tone = createMemo((): TimeSeriesChartTone => {
    const first = props.points[0]?.value ?? 0;
    const last = props.points[props.points.length - 1]?.value ?? 0;
    return last >= first ? 'positive' : 'negative';
  });

  return (
    <TimeSeriesLineChart
      class="sim-analytics-pnl-chart trader-capital-chart"
      points={chartPoints()}
      title="Évolution du capital"
      ariaLabel="Évolution du capital du trader dans le temps"
      tone={tone()}
      loading={props.loading}
      hint={props.hint}
      emptyHint="Pas assez d'activité pour reconstruire la courbe de capital."
    />
  );
}
