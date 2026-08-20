import { Show } from 'solid-js';
import type { BacktestRunDto } from '../../api';
import { EXIT_REASON_LABEL } from '@polywatch/core/backtest/exit-reasons';
import { fmtHolding, fmtPct, fmtUsd, formatNum } from './format';

interface BacktestMetricsProps {
  stats: NonNullable<BacktestRunDto['stats']>;
}

function pnlClass(value: number): string {
  return value > 0 ? 'backtest-pnl-pos' : value < 0 ? 'backtest-pnl-neg' : '';
}

export function BacktestMetrics(props: BacktestMetricsProps) {
  const s = () => props.stats;
  const hasExitBreakdown = () => Object.keys(s().byExitReason ?? {}).length > 0;
  const hasCityBreakdown = () => Object.keys(s().byCity ?? {}).length > 0;

  return (
    <div class="backtest-metrics">
      <div class="backtest-metric backtest-metric--hero">
        <span class="backtest-metric-label">P&L total</span>
        <span class={`backtest-metric-value backtest-metric-value--big ${pnlClass(s().totalPnl)}`}>
          {fmtUsd(s().totalPnl)}
        </span>
        <span class={`backtest-metric-sub ${pnlClass(s().pnlPct)}`}>
          {formatNum(s().pnlPct, 1)}%
        </span>
      </div>

      <div class="backtest-metric">
        <span class="backtest-metric-label">Equity finale</span>
        <span class="backtest-metric-value">{fmtUsd(s().finalEquity)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Drawdown max</span>
        <span class="backtest-metric-value backtest-metric-value--danger">{fmtPct(s().maxDrawdown)}</span>
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
        <span class="backtest-metric-label">Gain moy.</span>
        <span class="backtest-metric-value backtest-metric-value--success">{fmtUsd(s().avgWin)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Perte moy.</span>
        <span class="backtest-metric-value backtest-metric-value--danger">{fmtUsd(s().avgLoss)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Profit factor</span>
        <span class="backtest-metric-value">
          {s().profitFactor == null && s().totalTrades > 0 ? '∞' : formatNum(s().profitFactor, 2)}
        </span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Expectancy</span>
        <span class={`backtest-metric-value ${pnlClass(s().expectancy)}`}>{fmtUsd(s().expectancy)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Durée moy.</span>
        <span class="backtest-metric-value">{fmtHolding(s().avgHoldingMs)}</span>
      </div>

      <Show when={hasExitBreakdown()}>
        <div class="backtest-metric backtest-metric--wide">
          <span class="backtest-metric-label">Par sortie</span>
          <span class="backtest-metric-text">
            {Object.entries(s().byExitReason)
              .map(([k, n]) => `${EXIT_REASON_LABEL[k] ?? k}: ${n}`)
              .join(' · ')}
          </span>
        </div>
      </Show>

      <Show when={hasCityBreakdown()}>
        <div class="backtest-metric backtest-metric--wide">
          <span class="backtest-metric-label">Par ville</span>
          <span class="backtest-metric-text">
            {Object.entries(s().byCity)
              .map(([k, n]) => `${k}: ${n}`)
              .join(' · ')}
          </span>
        </div>
      </Show>
    </div>
  );
}
