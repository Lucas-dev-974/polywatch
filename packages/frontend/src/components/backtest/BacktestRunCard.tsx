import { Show } from 'solid-js';
import type { BacktestRunDto } from '../../api';
import { fmtPct, fmtUsd, formatTs } from './format';

const STATUS_LABEL: Record<string, string> = {
  queued: 'File',
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

/** Libellé de stratégie d'une run (snapshot, sinon id, sinon fallback). */
export function strategyLabel(run: BacktestRunDto): string {
  if (run.strategy?.label) return run.strategy.label;
  const sid = run.params?.strategyId as string | undefined;
  if (sid) return sid;
  return 'Sans stratégie';
}

interface BacktestRunCardProps {
  run: BacktestRunDto;
  onOpen: () => void;
}

export function BacktestRunCard(props: BacktestRunCardProps) {
  const run = props.run;
  const running = run.status === 'running' || run.status === 'queued';
  return (
    <button type="button" class="backtest-run-card" onClick={props.onOpen}>
      <div class="backtest-run-card-top">
        <span class="backtest-run-id">#{run.id}</span>
        <span class={`backtest-status backtest-status--${run.status}`}>
          {STATUS_LABEL[run.status] ?? run.status}
        </span>
      </div>
      <Show when={run.label}>
        <div class="backtest-run-card-title">{run.label}</div>
      </Show>
      <Show when={run.stats && run.status === 'completed'}>
        <div class="backtest-run-card-pnl">
          <span class="backtest-run-card-pnl-label">P&L</span>
          <strong class={(run.stats?.totalPnl ?? 0) >= 0 ? 'backtest-pnl-pos' : 'backtest-pnl-neg'}>
            {fmtUsd(run.stats?.totalPnl)}
          </strong>
        </div>
      </Show>
      <Show when={running}>
        <div class="backtest-progress">
          <div class="backtest-progress-track">
            <div class="backtest-progress-fill" style={{ width: `${run.progressPct}%` }} />
          </div>
          <span>{run.progressPct}%</span>
        </div>
      </Show>
      <div class="backtest-run-card-meta">
        <span>{formatTs(run.createdAt)}</span>
        <Show when={run.stats && run.status === 'completed'}>
          <span>{run.stats?.totalTrades ?? 0} trades</span>
          <span>Winrate {fmtPct(run.stats?.winRate)}</span>
        </Show>
      </div>
      <div class="backtest-run-card-foot">
        <span class="backtest-run-card-strategy">{strategyLabel(run)}</span>
        <span class="backtest-run-card-mode">{run.mode === 'replay' ? 'Rejouer' : 'Re-évaluer'}</span>
      </div>
    </button>
  );
}
