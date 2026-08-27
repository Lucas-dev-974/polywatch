import { For, createMemo } from 'solid-js';
import type { TraderInsightTimelinePoint } from '../../lib/trader-insight';

export function TraderActivityTimelineChart(props: {
  points: TraderInsightTimelinePoint[];
}) {
  const scale = createMemo(() => {
    const values = props.points.map((p) => p.tradeCount);
    return Math.max(...values, 1);
  });

  return (
    <section class="sim-analytics-rank trader-timeline-chart">
      <For each={props.points}>
        {(point) => {
          const width = () =>
            `${(point.tradeCount / scale()) * 100}%`;
          const weekLabel = () =>
            new Date(`${point.weekStart}T00:00:00.000Z`).toLocaleDateString(
              'fr-FR',
              { day: 'numeric', month: 'short' },
            );
          return (
            <div class="sim-analytics-rank-row">
              <span class="sim-analytics-rank-label">{weekLabel()}</span>
              <div class="sim-analytics-rank-bar-wrap">
                <div
                  class="sim-analytics-rank-bar is-positive"
                  style={{ width: width() }}
                />
              </div>
              <span class="sim-analytics-rank-value">{point.tradeCount}</span>
            </div>
          );
        }}
      </For>
      {props.points.length === 0 ? (
        <p class="form-hint sim-analytics-category-empty">
          Aucune activité enregistrée.
        </p>
      ) : null}
    </section>
  );
}
