import { For, Show } from 'solid-js';
import { formatDurationMs } from '../lib/date';
import { formatPnlAmount, formatPnlPercent, pnlClass } from '../lib/position';
import {
  formatCloseReasonBreakdown,
  formatProfitFactor,
  marketDisplayLabel,
  type MarketAnalyticsRow,
  type MarketAnalyticsTotals,
} from '../lib/market-analytics';
import {
  sortButtonLabel,
  type MarketSortDir,
  type MarketSortKey,
} from '../lib/market-analytics-sort';

interface Props {
  markets: MarketAnalyticsRow[];
  totals: MarketAnalyticsTotals;
  sortKey: MarketSortKey;
  sortDir: MarketSortDir;
  onToggleSort: (key: MarketSortKey) => void;
}

export function SimMarketAnalyticsTable(props: Props) {
  return (
    <div class="sim-analytics-table-wrap panel-scroll">
      <table class="data-table sim-analytics-table">
        <thead>
          <tr>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('market')}>
                {sortButtonLabel('market', 'Marché', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('category')}>
                {sortButtonLabel('category', 'Catégorie', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('traderCount')}>
                {sortButtonLabel('traderCount', 'Traders', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('positions')}>
                {sortButtonLabel('positions', 'Pos.', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('realizedPnl')}>
                {sortButtonLabel('realizedPnl', 'Réalisé', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('unrealizedPnl')}>
                {sortButtonLabel('unrealizedPnl', 'Latent', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('totalPnl')}>
                {sortButtonLabel('totalPnl', 'Total', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('roiPercent')}>
                {sortButtonLabel('roiPercent', 'ROI', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('winRatePercent')}>
                {sortButtonLabel('winRatePercent', 'Win %', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('profitFactor')}>
                {sortButtonLabel('profitFactor', 'PF', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>Yes/No</th>
            <th>Gain moy.</th>
            <th>Perte moy.</th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('avgHoldDurationMs')}>
                {sortButtonLabel('avgHoldDurationMs', 'Détention', props.sortKey, props.sortDir)}
              </button>
            </th>
            <th>Sorties</th>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('feesTotal')}>
                {sortButtonLabel('feesTotal', 'Frais', props.sortKey, props.sortDir)}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.markets}>
            {(market) => (
              <tr>
                <td>
                  <div class="sim-analytics-trader-cell">
                    <span>{marketDisplayLabel(market)}</span>
                    <Show when={market.marketResolved}>
                      <span class="badge badge-neutral">résolu</span>
                    </Show>
                    <Show when={market.marketClosed && !market.marketResolved}>
                      <span class="badge badge-warning">fermé</span>
                    </Show>
                  </div>
                </td>
                <td>{market.category ?? '—'}</td>
                <td>{market.traderCount}</td>
                <td>
                  <div class="sim-analytics-pos-cell">
                    <span>
                      {market.openPositionCount}/{market.closedPositionCount}
                    </span>
                    <span class="sim-analytics-pos-total">
                      ({market.positionCount})
                    </span>
                  </div>
                </td>
                <td class={pnlClass(market.realizedPnl)}>
                  {formatPnlAmount(market.realizedPnl, true)}
                </td>
                <td class={pnlClass(market.unrealizedPnl)}>
                  {formatPnlAmount(market.unrealizedPnl, true)}
                </td>
                <td class={pnlClass(market.totalPnl)}>
                  {formatPnlAmount(market.totalPnl, true)}
                </td>
                <td class={pnlClass(market.roiPercent ?? 0)}>
                  {formatPnlPercent(market.roiPercent ?? undefined)}
                </td>
                <td>
                  {market.winRatePercent != null
                    ? `${market.winRatePercent.toFixed(0)}%`
                    : '—'}
                </td>
                <td>
                  {formatProfitFactor(
                    market.profitFactor,
                    market.grossWinsTotal,
                    market.grossLossesTotal,
                  )}
                </td>
                <td>
                  <span class="sim-analytics-outcome-badge is-yes">{market.outcomeBreakdown.yes}</span>
                  {' / '}
                  <span class="sim-analytics-outcome-badge is-no">{market.outcomeBreakdown.no}</span>
                  <Show when={market.outcomeBreakdown.other > 0}>
                    {' / '}
                    <span class="sim-analytics-outcome-badge is-other">{market.outcomeBreakdown.other}</span>
                  </Show>
                </td>
                <td class={pnlClass(market.avgWinPnl ?? 0)}>
                  {market.avgWinPnl != null
                    ? formatPnlAmount(market.avgWinPnl, true)
                    : '—'}
                </td>
                <td class={pnlClass(market.avgLossPnl ?? 0)}>
                  {market.avgLossPnl != null
                    ? formatPnlAmount(market.avgLossPnl, true)
                    : '—'}
                </td>
                <td>{formatDurationMs(market.avgHoldDurationMs)}</td>
                <td class="sim-analytics-close-reasons">
                  {formatCloseReasonBreakdown(market.closeReasonBreakdown)}
                </td>
                <td>{formatPnlAmount(market.feesTotal)}</td>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr class="sim-analytics-totals-row">
            <td>Total ({props.totals.marketCount} marchés)</td>
            <td>—</td>
            <td>—</td>
            <td>
              <div class="sim-analytics-pos-cell">
                <span>
                  {props.totals.openPositionCount}/{props.totals.closedPositionCount}
                </span>
                <span class="sim-analytics-pos-total">
                  ({props.totals.positionCount})
                </span>
              </div>
            </td>
            <td class={pnlClass(props.totals.realizedPnl)}>
              {formatPnlAmount(props.totals.realizedPnl, true)}
            </td>
            <td class={pnlClass(props.totals.unrealizedPnl)}>
              {formatPnlAmount(props.totals.unrealizedPnl, true)}
            </td>
            <td class={pnlClass(props.totals.totalPnl)}>
              {formatPnlAmount(props.totals.totalPnl, true)}
            </td>
            <td class={pnlClass(props.totals.roiPercent ?? 0)}>
              {formatPnlPercent(props.totals.roiPercent ?? undefined)}
            </td>
            <td>
              {props.totals.winRatePercent != null
                ? `${props.totals.winRatePercent.toFixed(0)}%`
                : '—'}
            </td>
            <td>
              {formatProfitFactor(
                props.totals.profitFactor,
                props.totals.grossWinsTotal,
                props.totals.grossLossesTotal,
              )}
            </td>
            <td>
              <span class="sim-analytics-outcome-badge is-yes">{props.totals.outcomeBreakdown.yes}</span>
              {' / '}
              <span class="sim-analytics-outcome-badge is-no">{props.totals.outcomeBreakdown.no}</span>
              <Show when={props.totals.outcomeBreakdown.other > 0}>
                {' / '}
                <span class="sim-analytics-outcome-badge is-other">{props.totals.outcomeBreakdown.other}</span>
              </Show>
            </td>
            <td>—</td>
            <td>—</td>
            <td>{formatDurationMs(props.totals.avgHoldDurationMs)}</td>
            <td class="sim-analytics-close-reasons">
              {formatCloseReasonBreakdown(props.totals.closeReasonBreakdown)}
            </td>
            <td>{formatPnlAmount(props.totals.feesTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
