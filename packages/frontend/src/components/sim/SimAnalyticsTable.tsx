import { For, Show } from 'solid-js';
import { formatDurationMs } from '../../lib/date';
import { formatPnlAmount, formatPnlPercent, pnlClass } from '../../lib/position';
import {
  formatCloseReasonBreakdown,
  formatProfitFactor,
  traderDisplayName,
  type TraderAnalyticsRow,
  type TraderAnalyticsTotals,
} from '../../lib/trader-analytics';
import {
  sortButtonLabel,
  type SortDir,
  type SortKey,
} from '../../lib/sim-analytics-sort';

interface Props {
  traders: TraderAnalyticsRow[];
  totals: TraderAnalyticsTotals;
  sortKey: SortKey;
  sortDir: SortDir;
  selectedWatchlistId: number | null;
  onToggleSort: (key: SortKey) => void;
  onSelectTrader: (watchlistId: number | null) => void;
}

export function SimAnalyticsTable(props: Props) {
  return (
    <div class="sim-analytics-table-wrap panel-scroll">
      <table class="data-table sim-analytics-table">
        <thead>
          <tr>
            <th>
              <button type="button" class="sim-analytics-sort-btn" onClick={() => props.onToggleSort('trader')}>
                {sortButtonLabel('trader', 'Trader', props.sortKey, props.sortDir)}
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
          <For each={props.traders}>
            {(trader) => (
              <tr
                classList={{
                  'is-selected':
                    trader.watchlistId != null &&
                    trader.watchlistId === props.selectedWatchlistId,
                }}
                data-selectable={trader.watchlistId != null ? '' : undefined}
                onClick={() => props.onSelectTrader(trader.watchlistId)}
              >
                <td>
                  <div class="sim-analytics-trader-cell">
                    <span>{traderDisplayName(trader)}</span>
                    <Show when={!trader.inWatchlistSim}>
                      <span class="badge badge-neutral">hors watchlist</span>
                    </Show>
                  </div>
                </td>
                <td>
                  <div class="sim-analytics-pos-cell">
                    <span>
                      {trader.openPositionCount}/{trader.closedPositionCount}
                    </span>
                    <span class="sim-analytics-pos-total">
                      ({trader.positionCount})
                    </span>
                  </div>
                </td>
                <td class={pnlClass(trader.realizedPnl)}>
                  {formatPnlAmount(trader.realizedPnl, true)}
                </td>
                <td class={pnlClass(trader.unrealizedPnl)}>
                  {formatPnlAmount(trader.unrealizedPnl, true)}
                </td>
                <td class={pnlClass(trader.totalPnl)}>
                  {formatPnlAmount(trader.totalPnl, true)}
                </td>
                <td class={pnlClass(trader.roiPercent ?? 0)}>
                  {formatPnlPercent(trader.roiPercent ?? undefined)}
                </td>
                <td>
                  {trader.winRatePercent != null
                    ? `${trader.winRatePercent.toFixed(0)}%`
                    : '—'}
                </td>
                <td>
                  {formatProfitFactor(
                    trader.profitFactor,
                    trader.grossWinsTotal,
                    trader.grossLossesTotal,
                  )}
                </td>
                <td class={pnlClass(trader.avgWinPnl ?? 0)}>
                  {trader.avgWinPnl != null
                    ? formatPnlAmount(trader.avgWinPnl, true)
                    : '—'}
                </td>
                <td class={pnlClass(trader.avgLossPnl ?? 0)}>
                  {trader.avgLossPnl != null
                    ? formatPnlAmount(trader.avgLossPnl, true)
                    : '—'}
                </td>
                <td>{formatDurationMs(trader.avgHoldDurationMs)}</td>
                <td class="sim-analytics-close-reasons">
                  {formatCloseReasonBreakdown(trader.closeReasonBreakdown)}
                </td>
                <td>{formatPnlAmount(trader.feesTotal)}</td>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr class="sim-analytics-totals-row">
            <td>Total</td>
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
