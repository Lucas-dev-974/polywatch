import { Show, For } from 'solid-js';
import { useMetricsDashboard } from '../../hooks/useMetricsDashboard';

export function MetricsDashboardPage() {
  const { data, error } = useMetricsDashboard();

  return (
    <div class="system-tab-content page-metrics">
      <div class="page-header page-header-inline">
        <span class="text-muted text-sm">Mise a jour toutes les 10s</span>
      </div>

      <Show when={error()}>
        <div class="alert alert-warning">{error()}</div>
      </Show>

      <Show when={data()} fallback={<div class="loading">Chargement...</div>}>
        {(d) => (
          <>
            {/* Section: Positions */}
            <section class="panel">
              <div class="panel-header"><h2>Positions</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <StatCard label="Ouvertes" value={d().positions.open} />
                  <StatCard label="Illiquides" value={d().positions.illiquid} />
                  <StatCard label="Evaluees" value={d().strategy.evalPositions} />
                  <StatCard label="Spread moyen" value={formatPct(d().strategy.spreadMean)} />
                </div>
                <div class="stat-row" style="margin-top: 1rem">
                  <For each={Object.entries(d().positions.openByMode)}>
                    {([mode, count]) => <StatCard label={`Mode ${mode}`} value={count} />}
                  </For>
                  <For each={Object.entries(d().positions.byStatus)}>
                    {([status, count]) => <StatCard label={status} value={count} />}
                  </For>
                </div>
              </div>
            </section>

            {/* Section: Evenements de risque */}
            <section class="panel">
              <div class="panel-header"><h2>Evenements de risque</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <StatCard label="SL" value={d().exits.sl} />
                  <StatCard label="TP" value={d().exits.tp} />
                  <StatCard label="Trailing" value={d().exits.trailing} />
                  <StatCard label="Kill Switch" value={d().exits.killSwitch} />
                </div>
                <div class="stat-row" style="margin-top: 1rem">
                  <For each={Object.entries(d().exits.preClose)}>
                    {([type, count]) => <StatCard label={type} value={count} />}
                  </For>
                </div>
              </div>
            </section>

            {/* Section: Worker & Circuit Breaker */}
            <section class="panel">
              <div class="panel-header"><h2>Worker & Circuit Breaker</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <StatCard label="Dernier push" value={formatTimestamp(d().worker.lastPushTimestamp)} />
                  <For each={Object.entries(d().circuitBreaker)}>
                    {([name, state]) => (
                      <StatCard label={`CB ${name}`} value={state === 1 ? 'OUVERT' : 'ferme'} />
                    )}
                  </For>
                </div>
              </div>
            </section>

            {/* Section: Performances API */}
            <section class="panel">
              <div class="panel-header"><h2>Performances API</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <StatCard label="Cycle str. (ms)" value={formatDuration(d().strategy.evalDurationMs)} />
                  <StatCard label="CLOB (ms)" value={formatDuration(d().clob.fetchDurationMs)} />
                  <StatCard label="Data API (ms)" value={formatDuration(d().dataApi.fetchDurationMs)} />
                </div>
              </div>
            </section>

            {/* Section: Snapshots & Redemption */}
            <section class="panel">
              <div class="panel-header"><h2>Snapshots & Redemption</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <StatCard label="Snapshots" value={d().snapshots.count} />
                  <StatCard label="Purges" value={d().snapshots.purged} />
                  <For each={Object.entries(d().snapshots.created)}>
                    {([source, count]) => <StatCard label={`Crees ${source}`} value={count} />}
                  </For>
                </div>
              </div>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}

function StatCard(props: { label: string; value: string | number }) {
  return (
    <div class="stat-card">
      <span class="stat-label">{props.label}</span>
      <span class="stat-value">{props.value}</span>
    </div>
  );
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDuration(d: { count: number; sum: number }): string {
  if (d.count === 0) return '-';
  return `${(d.sum / d.count).toFixed(1)}`;
}

function formatTimestamp(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString();
}
