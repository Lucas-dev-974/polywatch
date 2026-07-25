import { For, createMemo } from 'solid-js';
import { marketTagSlugLabel } from '../lib/market-tags';
import { formatPnlAmount, pnlClass } from '../lib/position';
import type { MarketCategoryPnlRow } from '../lib/trader-analytics';

function categoryLabel(row: MarketCategoryPnlRow): string {
  if (row.slug === 'other') return row.label;
  return marketTagSlugLabel(row.slug);
}

export function SimAnalyticsCategoryChart(props: {
  rows: MarketCategoryPnlRow[];
  scopeLabel?: string;
}) {
  const visibleRows = createMemo(() =>
    props.rows.filter((row) => row.positionCount > 0),
  );

  const scale = createMemo(() => {
    const values = visibleRows().map((row) => Math.abs(row.pnl));
    return Math.max(...values, 1);
  });

  return (
    <section class="sim-analytics-rank sim-analytics-category">
      <h3 class="sim-analytics-section-title">
        PnL par catégorie
        {props.scopeLabel ? (
          <span class="sim-analytics-category-scope"> · {props.scopeLabel}</span>
        ) : null}
      </h3>
      <For each={visibleRows()}>
        {(row) => {
          const width = () =>
            `${(Math.abs(row.pnl) / scale()) * 100}%`;
          return (
            <div class="sim-analytics-rank-row">
              <span class="sim-analytics-rank-label">
                {categoryLabel(row)}
                <span class="sim-analytics-category-count">
                  {' '}
                  ({row.positionCount})
                </span>
              </span>
              <div class="sim-analytics-rank-bar-wrap">
                <div
                  class="sim-analytics-rank-bar"
                  classList={{
                    'is-positive': row.pnl > 0,
                    'is-negative': row.pnl < 0,
                    'is-flat': row.pnl === 0,
                  }}
                  style={{ width: width() }}
                />
              </div>
              <span class={`sim-analytics-rank-value ${pnlClass(row.pnl)}`}>
                {formatPnlAmount(row.pnl, true)}
              </span>
            </div>
          );
        }}
      </For>
      {visibleRows().length === 0 ? (
        <p class="form-hint sim-analytics-category-empty">
          Aucune position classée pour ce périmètre.
        </p>
      ) : null}
    </section>
  );
}
