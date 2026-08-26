import { For, Show, createSignal, onMount } from 'solid-js';
import { useCryptoAlgoMonitor } from '../hooks/useCryptoAlgoMonitor';

export function CryptoAlgoMonitorPage() {
  const monitor = useCryptoAlgoMonitor();
  const [durationHours, setDurationHours] = createSignal(24);
  const [intervalSeconds, setIntervalSeconds] = createSignal(60);

  let logRef: HTMLPreElement | undefined;

  onMount(() => {
    // Scroll to bottom whenever logs change is handled via effect below.
  });

  return (
    <div class="system-tab-content page-crypto-algo-monitor">
      <div class="page-header page-header-inline">
        <div>
          <h2>Crypto-Algo Monitor</h2>
          <p class="page-header-sub">Surveillance live des signaux, positions et sorties de l'algo crypto.</p>
        </div>
        <div class="page-header-actions">
          <label class="form-hint" style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
            Durée (h)
            <input
              type="number"
              class="input input-sm"
              min={1}
              max={48}
              value={durationHours()}
              disabled={monitor.running()}
              onInput={(e) => setDurationHours(Number(e.currentTarget.value))}
            />
          </label>
          <label class="form-hint" style={{ display: 'flex', 'align-items': 'center', gap: '0.5rem' }}>
            Intervalle (s)
            <input
              type="number"
              class="input input-sm"
              min={10}
              max={600}
              value={intervalSeconds()}
              disabled={monitor.running()}
              onInput={(e) => setIntervalSeconds(Number(e.currentTarget.value))}
            />
          </label>
          <Show
            when={monitor.running()}
            fallback={
              <button
                type="button"
                class="btn btn-primary"
                onClick={() =>
                  monitor.start({
                    durationHours: durationHours(),
                    intervalSeconds: intervalSeconds(),
                  })
                }
              >
                Lancer le monitor
              </button>
            }
          >
            <button type="button" class="btn btn-danger" onClick={() => monitor.stop()}>
              Arrêter
            </button>
          </Show>
        </div>
      </div>

      <Show when={monitor.error()}>
        <div class="alert alert-warning">{monitor.error()}</div>
      </Show>

      <Show when={monitor.runId()}>
        <section class="panel">
          <div class="panel-header">
            <h3>Vue d'ensemble</h3>
            <span class="panel-header-meta">
              {monitor.finished() ? 'Terminé' : monitor.running() ? 'En cours' : 'Inactif'}
              {monitor.exitCode() != null ? ` • exit=${monitor.exitCode()}` : ''}
            </span>
          </div>
          <div class="panel-body">
            <div class="stat-row">
              <StatCard label="Run ID" value={monitor.runId() ?? '-'} />
              <StatCard label="Marchés suivis" value={monitor.latestSnapshot()?.signals.totalConditions ?? 0} />
              <StatCard label="WS Healthy" value={formatRatio(monitor.latestSnapshot()?.signals.wsHealthyRatio)} />
              <StatCard label="Positions ouvertes" value={monitor.latestSnapshot()?.positions.openCount ?? 0} />
              <StatCard label="Exposition" value={`$${monitor.latestSnapshot()?.positions.openExposureUsd ?? 0}`} />
              <StatCard label="PnL unrealized" value={monitor.latestSnapshot()?.positions.openUnrealizedPnl ?? 0} />
              <StatCard label="Win rate (closes)" value={formatRatio(monitor.latestSnapshot()?.closed.winRate)} />
            </div>
          </div>
        </section>
      </Show>

      <Show when={monitor.latestSnapshot()}>
        {(s) => (
          <>
            <section class="panel">
              <div class="panel-header"><h3>Signaux / Abstentions</h3></div>
              <div class="panel-body">
                <div class="table-responsive">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Raison d'abstention</th>
                        <th>Compte</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For
                        each={Object.entries(s().signals.byAbstainReason).sort((a, b) => b[1] - a[1])}
                      >
                        {([reason, count]) => (
                          <tr>
                            <td>{reason}</td>
                            <td>{count}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-header"><h3>Positions fermées</h3></div>
              <div class="panel-body">
                <div class="table-responsive">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Raison</th>
                        <th>Nombre</th>
                        <th>PnL total</th>
                        <th>PnL moyen</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For
                        each={Object.entries(s().closed.byCloseReason).sort(
                          (a, b) => b[1].count - a[1].count
                        )}
                      >
                        {([reason, data]) => (
                          <tr>
                            <td>{reason}</td>
                            <td>{data.count}</td>
                            <td>{data.pnl.toFixed(4)}</td>
                            <td>{data.count > 0 ? (data.pnl / data.count).toFixed(4) : '0'}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-header"><h3>Positions ouvertes</h3></div>
              <div class="panel-body">
                <div class="table-responsive">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Condition</th>
                        <th>Mode</th>
                        <th>Outcome</th>
                        <th>Entry</th>
                        <th>Bid</th>
                        <th>PnL</th>
                        <th>SL/TP</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={s().openPositions}>
                        {(p) => (
                          <tr>
                            <td title={p.question ?? undefined}>{p.conditionId.slice(0, 12)}...</td>
                            <td>{p.mode}</td>
                            <td>{p.outcome}</td>
                            <td>{p.entryPrice?.toFixed(3) ?? '-'}</td>
                            <td>{p.executableBidVwap?.toFixed(3) ?? '-'}</td>
                            <td
                              class={
                                p.unrealizedPnl != null && p.unrealizedPnl >= 0 ? 'text-ok' : 'text-danger'
                              }
                            >
                              {p.unrealizedPnl?.toFixed(4) ?? '-'}
                            </td>
                            <td>
                              {p.slPercent != null ? `SL ${p.slPercent}%` : '-'}
                              {' / '}
                              {p.tpPercent != null ? `TP ${p.tpPercent}%` : '-'}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <Show when={s().exitProblems.length > 0}>
              <section class="panel">
                <div class="panel-header"><h3>Problèmes de sortie</h3></div>
                <div class="panel-body">
                  <div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Condition</th>
                          <th>Mode</th>
                          <th>Raison blocage</th>
                          <th>Bloqué</th>
                          <th>Échecs</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={s().exitProblems}>
                          {(p) => (
                            <tr>
                              <td>{p.conditionId.slice(0, 12)}...</td>
                              <td>{p.mode}</td>
                              <td>{p.blockedReason ?? p.blockedCloseReason ?? '-'}</td>
                              <td>{p.blockedCount}</td>
                              <td>{p.failedAttempts}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </Show>
          </>
        )}
      </Show>

      <section class="panel">
        <div class="panel-header"><h3>Logs live</h3></div>
        <div class="panel-body">
          <pre
            ref={logRef}
            class="e2e-log-terminal"
            style={{ 'max-height': '400px', 'overflow-y': 'auto', 'white-space': 'pre-wrap' }}
          >
            {monitor.logs() || '(aucun log)'}
          </pre>
        </div>
      </section>
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

function formatRatio(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(0)}%`;
}
