import { For, Show, createMemo } from 'solid-js';
import type { BacktestRunDto, BacktestMode, BacktestStats } from '../../api';
import { Pagination } from '../Pagination';
import { fmtPct, fmtUsd } from './format';
import { BacktestRunCard, strategyLabel } from './BacktestRunCard';

const MODE_LABEL: Record<BacktestMode, string> = {
  reevaluate: 'Re-évaluer',
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

/** Clé de stratégie pour le regroupement d'une run. */
function strategyKey(run: BacktestRunDto): string {
  return run.strategy?.id ?? (run.params?.strategyId as string | undefined) ?? '__none__';
}

interface GroupStats {
  count: number;
  completed: number;
  totalPnl: number;
  totalTrades: number;
  winRateSum: number;
  winRateCount: number;
  running: number;
}

function emptyGroupStats(): GroupStats {
  return { count: 0, completed: 0, totalPnl: 0, totalTrades: 0, winRateSum: 0, winRateCount: 0, running: 0 };
}

function accumulate(stats: GroupStats, run: BacktestRunDto): void {
  stats.count++;
  if (run.status === 'running' || run.status === 'queued') stats.running++;
  if (run.status === 'completed' && run.stats) {
    const s = run.stats as BacktestStats;
    stats.completed++;
    stats.totalPnl += s.totalPnl;
    stats.totalTrades += s.totalTrades;
    if (Number.isFinite(s.winRate)) {
      stats.winRateSum += s.winRate;
      stats.winRateCount++;
    }
  }
}

export function BacktestRunList(props: BacktestRunListProps) {
  // Regroupement : mode -> strategyKey -> { label, runs, stats }
  const groups = createMemo(() => {
    const byMode = new Map<BacktestMode, Map<string, { label: string; runs: BacktestRunDto[]; stats: GroupStats }>>();
    for (const run of props.runs) {
      let byStrat = byMode.get(run.mode);
      if (!byStrat) {
        byStrat = new Map();
        byMode.set(run.mode, byStrat);
      }
      const key = strategyKey(run);
      let bucket = byStrat.get(key);
      if (!bucket) {
        bucket = { label: strategyLabel(run), runs: [], stats: emptyGroupStats() };
        byStrat.set(key, bucket);
      }
      bucket.runs.push(run);
      accumulate(bucket.stats, run);
    }
    // Ordre stable : reevaluate.
    const modes: BacktestMode[] = ['reevaluate'];
    return modes
      .filter((m) => byMode.has(m))
      .map((m) => ({ mode: m, strategies: Array.from(byMode.get(m)!.values()) }));
  });

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
      <For each={groups()}>
        {(modeGroup) => (
          <section class="backtest-run-group">
            <div class="backtest-run-group-head">
              <span class={`backtest-mode-badge backtest-mode-badge--${modeGroup.mode}`}>
                {MODE_LABEL[modeGroup.mode]}
              </span>
              <span class="backtest-run-group-count">
                {modeGroup.strategies.reduce((n, s) => n + s.runs.length, 0)} run(s)
              </span>
            </div>
            <For each={modeGroup.strategies}>
              {(strat) => (
                <div class="backtest-run-subgroup">
                  <div class="backtest-run-subgroup-head">
                    <span class="backtest-run-subgroup-label">{strat.label}</span>
                    <span class="backtest-run-subgroup-stats">
                      {strat.runs.length} run(s)
                      <Show when={strat.stats.completed > 0}>
                        <span>· P&L <strong class={strat.stats.totalPnl >= 0 ? 'backtest-pnl-pos' : 'backtest-pnl-neg'}>{fmtUsd(strat.stats.totalPnl)}</strong></span>
                        <span>· {strat.stats.totalTrades} trades</span>
                        <Show when={strat.stats.winRateCount > 0}>
                          <span>· Winrate <strong>{fmtPct(strat.stats.winRateSum / strat.stats.winRateCount)}</strong></span>
                        </Show>
                      </Show>
                      <Show when={strat.stats.running > 0}>
                        <span class="backtest-run-subgroup-live">· {strat.stats.running} en cours</span>
                      </Show>
                    </span>
                  </div>
                  <div class="backtest-run-cards">
                    <For each={strat.runs}>
                      {(run) => <BacktestRunCard run={run} onOpen={() => props.onOpen(run.id)} />}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </section>
        )}
      </For>
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
