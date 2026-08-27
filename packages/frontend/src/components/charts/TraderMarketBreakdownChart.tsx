import { For, createMemo } from 'solid-js';
import { marketTagSlugLabel } from '../../lib/market-tags';
import type { TraderInsightMarketBreakdownRow } from '../../lib/trader-insight';

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function categoryLabel(row: TraderInsightMarketBreakdownRow): string {
  if (row.slug === 'other') return row.label;
  return marketTagSlugLabel(row.slug);
}

export function TraderMarketBreakdownChart(props: {
  rows: TraderInsightMarketBreakdownRow[];
}) {
  const visibleRows = createMemo(() =>
    [...props.rows].sort((a, b) => b.volumeUsdc - a.volumeUsdc),
  );

  const scale = createMemo(() => {
    const values = visibleRows().map((row) => row.volumeUsdc);
    return Math.max(...values, 1);
  });

  return (
    <section class="sim-analytics-rank sim-analytics-category">
      <For each={visibleRows()}>
        {(row) => {
          const width = () =>
            `${(row.volumeUsdc / scale()) * 100}%`;
          return (
            <div class="sim-analytics-rank-row">
              <span class="sim-analytics-rank-label">
                {categoryLabel(row)}
                <span class="sim-analytics-category-count">
                  {' '}
                  ({row.tradeCount} trades · {row.uniqueMarkets} marchés)
                </span>
              </span>
              <div class="sim-analytics-rank-bar-wrap">
                <div
                  class="sim-analytics-rank-bar is-positive"
                  style={{ width: width() }}
                />
              </div>
              <span class="sim-analytics-rank-value">
                {formatUsd(row.volumeUsdc)}
              </span>
            </div>
          );
        }}
      </For>
      {visibleRows().length === 0 ? (
        <p class="form-hint sim-analytics-category-empty">
          Aucun marché classé pour ce trader.
        </p>
      ) : null}
    </section>
  );
}
