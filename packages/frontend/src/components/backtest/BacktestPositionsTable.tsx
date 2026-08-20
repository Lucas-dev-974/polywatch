import { For, Show } from 'solid-js';
import type { BacktestPositionDto } from '../../api';
import { EXIT_REASON_LABEL } from '@polywatch/core/backtest/exit-reasons';
import { fmtUsd, formatNum } from './format';

interface BacktestPositionsTableProps {
  positions: BacktestPositionDto[];
}

export function BacktestPositionsTable(props: BacktestPositionsTableProps) {
  return (
    <Show when={props.positions.length > 0}>
      <div class="backtest-section">
        <h4 class="settings-subheading">Positions ({props.positions.length})</h4>
        <div class="weather-data-table-wrap">
          <table class="weather-data-table">
            <thead>
              <tr>
                <th>Ville</th>
                <th>conditionId</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>P&L</th>
                <th>Motif exit</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.positions}>
                {(p) => (
                  <tr>
                    <td>{p.city ?? '—'}</td>
                    <td class="text-mono" title={p.conditionId}>
                      {p.conditionId.slice(0, 18)}…
                    </td>
                    <td>{formatNum(p.entryPrice, 3)}</td>
                    <td>{p.exitPrice != null ? formatNum(p.exitPrice, 3) : '—'}</td>
                    <td class={p.pnl != null && p.pnl >= 0 ? 'backtest-pnl-pos' : 'backtest-pnl-neg'}>
                      {p.pnl != null ? fmtUsd(p.pnl) : '—'}
                    </td>
                    <td>{p.exitReason ? (EXIT_REASON_LABEL[p.exitReason] ?? p.exitReason) : 'Ouverte'}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
}
