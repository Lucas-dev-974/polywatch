import type { SimStateSnapshotSummary } from '../lib/simulation-snapshots';
import { buildPoints } from '../lib/equity-chart';
import { TimeSeriesLineChart } from './TimeSeriesLineChart';

interface Props {
  items: SimStateSnapshotSummary[];
}

export function SimSnapshotEquityChart(props: Props) {
  const points = () => buildPoints(props.items);

  return (
    <TimeSeriesLineChart
      points={points()}
      title="Évolution equity"
      ariaLabel="Évolution de l'equity dans le temps"
      tone="sim"
      emptyHint="Au moins 2 snapshots pour afficher la courbe."
    />
  );
}
