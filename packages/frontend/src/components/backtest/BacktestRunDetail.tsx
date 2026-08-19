import { For, Show } from 'solid-js';
import type {
  BacktestEquityPointDto,
  BacktestPositionDto,
  BacktestRunDto,
} from '../../api';
import { BacktestEquityChart } from '../BacktestEquityChart';
import { EXIT_REASON_LABEL } from '@polywatch/core/backtest/exit-reasons';
import { fmtHolding, fmtPct, fmtUsd, formatNum, formatTs } from './format';

interface BacktestRunDetailProps {
  run: BacktestRunDto;
  equity: BacktestEquityPointDto[];
  positions: BacktestPositionDto[];
  loading: boolean;
  error: string | null;
  capital: number;
  onBack: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function BacktestRunDetail(props: BacktestRunDetailProps) {
  const run = () => props.run;
  const stats = () => props.run.stats;
  const isRunning = () => props.run.status === 'running' || props.run.status === 'queued';

  return (
    <div class="backtest-detail">
      <div class="backtest-toolbar">
        <div class="backtest-toolbar-left">
          <button type="button" class="btn btn-sm btn-ghost" onClick={props.onBack}>
            ← Retour
          </button>
          <h3 class="settings-subheading">Backtest #{props.run.id}</h3>
        </div>
        <div class="backtest-toolbar-actions">
          <Show when={isRunning()}>
            <button type="button" class="btn btn-sm btn-secondary" onClick={props.onCancel}>
              Annuler
            </button>
          </Show>
          <button type="button" class="btn btn-sm btn-danger" onClick={props.onDelete}>
            Supprimer
          </button>
        </div>
      </div>

      <Show when={props.error}>
        <p class="form-hint weather-settings-error">{props.error}</p>
      </Show>

      <div class="backtest-detail-meta">
        <span>
          Statut : <strong>{props.run.status}</strong>
        </span>
        <span>
          Mode : <strong>{props.run.mode === 'replay' ? 'Rejouer' : 'Re-évaluer'}</strong>
        </span>
        <span>Lancé : {formatTs(props.run.startedAt)}</span>
        <span>Fini : {formatTs(props.run.finishedAt)}</span>
        <span>Plage : {formatTs(props.run.dataRangeFrom)} → {formatTs(props.run.dataRangeTo)}</span>
      </div>

      <Show when={isRunning()}>
        <div class="backtest-progress backtest-progress--wide">
          <div class="backtest-progress-track">
            <div class="backtest-progress-fill" style={{ width: `${props.run.progressPct}%` }} />
          </div>
          <span>{props.run.progressPct}%</span>
        </div>
      </Show>

      <Show when={props.run.status === 'failed' && props.run.error}>
        <p class="form-hint weather-settings-error">
          Erreur : <code>{props.run.error}</code>
        </p>
      </Show>

      <Show when={stats() != null}>
        <MetricGrid stats={stats()!} capital={props.capital} />
      </Show>

      <Show when={props.equity.length > 0}>
        <div class="backtest-section">
          <h4 class="settings-subheading">Courbe d’equity</h4>
          <BacktestEquityChart points={props.equity} capital={props.capital} />
        </div>
      </Show>

      <Show when={props.run.fidelityWarnings && props.run.fidelityWarnings.length > 0}>
        <div class="backtest-fidelity">
          <h4 class="settings-subheading">Limites de fidélité</h4>
          <ul>
            <For each={props.run.fidelityWarnings!}>
              {(w) => <li>{w}</li>}
            </For>
          </ul>
        </div>
      </Show>

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
    </div>
  );
}

function MetricGrid(props: { stats: NonNullable<BacktestRunDto['stats']>; capital: number }) {
  const s = props.stats;
  return (
    <div class="backtest-metrics">
      <div class="backtest-metric">
        <span class="backtest-metric-label">P&L total</span>
        <span class="backtest-metric-value">{fmtUsd(s.totalPnl)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">P&L %</span>
        <span class="backtest-metric-value">{formatNum(s.pnlPct, 1)}%</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Equity finale</span>
        <span class="backtest-metric-value">{fmtUsd(s.finalEquity)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Drawdown max</span>
        <span class="backtest-metric-value">{fmtPct(s.maxDrawdown)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Trades</span>
        <span class="backtest-metric-value">{s.totalTrades}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Winrate</span>
        <span class="backtest-metric-value">{fmtPct(s.winRate)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Profit factor</span>
        <span class="backtest-metric-value">
          {s.profitFactor == null && s.totalTrades > 0 ? '∞' : formatNum(s.profitFactor, 2)}
        </span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Expectancy</span>
        <span class="backtest-metric-value">{fmtUsd(s.expectancy)}</span>
      </div>
      <div class="backtest-metric">
        <span class="backtest-metric-label">Durée moy.</span>
        <span class="backtest-metric-value">{fmtHolding(s.avgHoldingMs)}</span>
      </div>
      <Show when={Object.keys(s.byExitReason ?? {}).length > 0}>
        <div class="backtest-metric backtest-metric--wide">
          <span class="backtest-metric-label">Par sortie</span>
          <span class="backtest-metric-value">
            {Object.entries(s.byExitReason)
              .map(([k, n]) => `${EXIT_REASON_LABEL[k] ?? k}: ${n}`)
              .join(' · ')}
          </span>
        </div>
      </Show>
      <Show when={Object.keys(s.byCity ?? {}).length > 0}>
        <div class="backtest-metric backtest-metric--wide">
          <span class="backtest-metric-label">Par ville</span>
          <span class="backtest-metric-value">
            {Object.entries(s.byCity)
              .map(([k, n]) => `${k}: ${n}`)
              .join(' · ')}
          </span>
        </div>
      </Show>
    </div>
  );
}
