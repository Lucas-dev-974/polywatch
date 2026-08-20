import { Show } from 'solid-js';
import type { BacktestRunDto } from '../../api';
import { EXIT_REASON_LABEL } from '@polywatch/core/backtest/exit-reasons';
import { fmtHolding, fmtPct, fmtUsd, formatNum } from './format';

interface BacktestMetricsProps {
  stats: NonNullable<BacktestRunDto['stats']>;
}

export function BacktestMetrics(props: BacktestMetricsProps) {
  const s = () => props.stats;
  return (
    <div class="backtest-metrics">
      <div class="backtest-metric">
        <span class="backtest-metric-label">P&L total</span>
        <span class="backtest-metric-value">{fmtUsd(s().totalPnl)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">P&L %</span>
        <span class="backtest-metric-value">{formatNum(s().pnlPct, 1)}%</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Equity finale</span>
        <span class="backtest-metric-value">{fmtUsd(s().finalEquity)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Drawdown max</span>
        <span class="backtest-metric-value">{fmtPct(s().maxDrawdown)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Trades</span>
        <span class="backtest-metric-value">{s().totalTrades}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Winrate</span>
        <span class="backtest-metric-value">{fmtPct(s().winRate)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Profit factor</span>
        <span class="backtest-metric-value">
          {s().profitFactor == null && s().totalTrades > 0 ? '∞' : formatNum(s().profitFactor, 2)}
        </span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Expectancy</span>
        <span class="backtest-metric-value">{fmtUsd(s().expectancy)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Durée moy.</span>
        <span class="backtest-metric-value">{fmtHolding(s().avgHoldingMs)}</span>
      </div>
      <Show when={Object.keys(s().byExitReason ?? {}).length > 0}>
        <div class="backtest-metric backtest-metric--wide">
          <span class="backtest-metric-label">Par sortie</span>
          <span class="backtest-metric-value">
            {Object.entries(s().byExitReason)
              .map(([k, n]) => `${EXIT_REASON_LABEL[k] ?? k}: ${n}`)
              .join(' · ')}
          </span>
        </div>
      </Show>
      <Show when={Object.keys(s().byCity ?? {}).length > 0}>
        <div class="backtest-metric backtest-metric--wide">
          <span class="backtest-metric-label">Par ville</span>
          <span class="backtest-metric-value">
            {Object.entries(s().byCity)
              .map(([k, n]) => `${k}: ${n}`)
              .join(' · ')}
          </span>
        </div>
      </Show>
    </div>
  );
}
