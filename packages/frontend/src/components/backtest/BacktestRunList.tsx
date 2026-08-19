import { For, Show } from 'solid-js';
import type { BacktestRunDto } from '../../api';
import { Pagination } from '../Pagination';
import { fmtPct, fmtUsd, formatTs } from './format';

const STATUS_LABEL: Record<string, string> = {
  queued: 'File',
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

interface BacktestRunListProps {
  runs: BacktestRunDto[];
  total: number;
  loading: boolean;
  page: number;
  pageCount: number;
  onOpen: (id: number) => void;
  onPage: (next: number) => void;
}

export function BacktestRunList(props: BacktestRunListProps) {
  return (
    <div class="backtest-list">
      <div class="backtest-list-header">
        <h3 class="settings-subheading">Runs</h3>
        <span class="algo-panel-count">{props.total.toLocaleString()} run(s)</span>
      </div>
      <Show when={props.loading && props.runs.length === 0}>
        <p class="form-hint">Chargement…</p>
      </Show>
      <Show when={props.runs.length === 0 && !props.loading}>
        <p class="form-hint">Aucun backtest pour l’instant.</p>
      </Show>
      <div class="backtest-run-cards">
        <For each={props.runs}>
          {(run) => <RunCard run={run} onOpen={() => props.onOpen(run.id)} />}
        </For>
      </div>
      <Show when={props.pageCount > 1}>
        <Pagination
          page={props.page}
          pageCount={props.pageCount}
          onPage={props.onPage}
        />
      </Show>
    </div>
  );
}

function RunCard(props: { run: BacktestRunDto; onOpen: () => void }) {
  const run = props.run;
  return (
    <button type="button" class="backtest-run-card" onClick={props.onOpen}>
      <div class="backtest-run-card-top">
        <span class="backtest-run-id">#{run.id}</span>
        <span class={`backtest-status backtest-status--${run.status}`}>
          {STATUS_LABEL[run.status] ?? run.status}
        </span>
      </div>
      <div class="backtest-run-card-meta">
        <span>{run.mode === 'replay' ? 'Rejouer' : 'Re-évaluer'}</span>
        {run.label ? <span>{run.label}</span> : null}
        <span>{formatTs(run.createdAt)}</span>
      </div>
      <Show when={run.status === 'running' || run.status === 'queued'}>
        <div class="backtest-progress">
          <div class="backtest-progress-track">
            <div class="backtest-progress-fill" style={{ width: `${run.progressPct}%` }} />
          </div>
          <span>{run.progressPct}%</span>
        </div>
      </Show>
      <Show when={run.stats && run.status === 'completed'}>
        <div class="backtest-run-card-stats">
          <span>
            P&L <strong>{fmtUsd(run.stats?.totalPnl)}</strong>
          </span>
          <span>
            Trades <strong>{run.stats?.totalTrades ?? 0}</strong>
          </span>
          <span>
            Winrate <strong>{fmtPct(run.stats?.winRate)}</strong>
          </span>
        </div>
      </Show>
    </button>
  );
}
