import { For, Show } from 'solid-js';
import { useSystemOverview } from '../../hooks/useSystemOverview';
import { useSystemAudit } from '../../hooks/useSystemAudit';
import type { AuditScriptId, ProcessStatus } from '../../lib/system-overview';

const AUDIT_ACTIONS: { id: AuditScriptId; label: string; dangerous?: boolean }[] = [
  { id: 'redis-queues', label: 'Auditer files Redis' },
  { id: 'redis-clients', label: 'Auditer clients Redis' },
  { id: 'worker-liveness', label: 'Auditer liveness worker' },
  { id: 'pending-algo', label: 'Auditer algo en attente' },
  { id: 'recent-outcomes', label: 'Auditer outcomes récents' },
  { id: 'flush-redis-queues', label: 'Vider les files Redis', dangerous: true },
];

export function SystemOverviewPage() {
  const { data, error, loading } = useSystemOverview();
  const audit = useSystemAudit();

  function handleRunAudit(id: AuditScriptId, dangerous?: boolean) {
    if (dangerous) {
      const ok = window.confirm(
        'Vider les files Redis va supprimer tous les jobs en attente. Cette action est irréversible. Continuer ?',
      );
      if (!ok) return;
      void audit.runAudit(id, true);
    } else {
      void audit.runAudit(id);
    }
  }

  return (
    <div class="system-tab-content page-system-overview">
      <div class="page-header page-header-inline">
        <span class="text-muted text-sm">Mise à jour toutes les 10s</span>
      </div>

      <Show when={error()}>
        <div class="alert alert-warning">{error()}</div>
      </Show>

      <Show when={loading() && !data()}>
        <div class="loading">Chargement...</div>
      </Show>

      <Show when={data()}>
        {(d) => (
          <>
            {/* Section 1 : Services */}
            <section class="panel">
              <div class="panel-header"><h2>Services</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <ServiceCard
                    name="Backend"
                    status={d().services.backend}
                    pid={d().backend.pid}
                    uptime={d().backend.uptimeSeconds}
                  />
                  <ServiceCard
                    name="Worker"
                    status={statusFromProcess(d().processes, 'worker')}
                    lastSeen={lastSeenFromProcess(d().processes, 'worker')}
                  />
                  <ServiceCard
                    name="Crypto Algo"
                    status={statusFromProcess(d().processes, 'crypto-algo')}
                    lastSeen={lastSeenFromProcess(d().processes, 'crypto-algo')}
                    extra={extraFromProcess(d().processes, 'crypto-algo')}
                  />
                  <ServiceCard name="Redis" status={d().services.redis} />
                  <ServiceCard name="PostgreSQL" status={d().services.postgres} />
                </div>
              </div>
            </section>

            {/* Section 2 : Files Redis */}
            <section class="panel">
              <div class="panel-header"><h2>Files Redis</h2></div>
              <div class="panel-body">
                <div class="stat-row">
                  <For each={d().queues}>
                    {(q) => (
                      <QueueCard
                        name={q.name}
                        depth={q.depth}
                        processing={q.processing}
                        dead={q.dead}
                      />
                    )}
                  </For>
                </div>
              </div>
            </section>

            {/* Section 3 : Actions de diagnostic */}
            <section class="panel">
              <div class="panel-header"><h2>Actions de diagnostic</h2></div>
              <div class="panel-body">
                <div class="stat-row" style="flex-wrap: wrap; gap: 0.5rem">
                  <For each={AUDIT_ACTIONS}>
                    {(action) => (
                      <button
                        type="button"
                        class={`btn ${action.dangerous ? 'btn-danger' : 'btn-primary'} btn-sm`}
                        disabled={audit.running()}
                        onClick={() => handleRunAudit(action.id, action.dangerous)}
                      >
                        {action.label}
                      </button>
                    )}
                  </For>
                </div>

                <Show when={audit.running() || audit.finished()}>
                  <div style="margin-top: 1rem">
                    <Show when={audit.error()}>
                      <div class="alert alert-warning">{audit.error()}</div>
                    </Show>
                    <Show when={audit.finished()}>
                      <p class="text-muted text-sm">
                        Terminé (code {audit.exitCode()}) en {formatDuration(audit.runId())}
                      </p>
                    </Show>
                    <Show when={audit.logs()}>
                      <pre class="e2e-log-terminal" style="max-height: 400px; overflow-y: auto">
                        {audit.logs()}
                      </pre>
                    </Show>
                  </div>
                </Show>
              </div>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}

// ── Sous-composants ──────────────────────────────────────────────────

function ServiceCard(props: {
  name: string;
  status: 'ok' | 'down' | 'warning';
  pid?: number | null;
  uptime?: number | null;
  lastSeen?: string | null;
  extra?: Record<string, unknown>;
}) {
  const statusClass = () => {
    if (props.status === 'ok') return 'stat-value-ok';
    if (props.status === 'warning') return 'stat-value-warning';
    return 'stat-value-down';
  };
  const statusLabel = () => {
    if (props.status === 'ok') return 'OK';
    if (props.status === 'warning') return 'Avertissement';
    return 'HS';
  };

  return (
    <div class="stat-card">
      <span class="stat-label">{props.name}</span>
      <span class={`stat-value ${statusClass()}`}>{statusLabel()}</span>
      <Show when={props.pid != null}>
        <span class="text-muted text-xs">PID {props.pid}</span>
      </Show>
      <Show when={props.uptime != null}>
        <span class="text-muted text-xs">Uptime {formatDuration(props.uptime!)}</span>
      </Show>
      <Show when={props.lastSeen}>
        <span class="text-muted text-xs">Vu {formatRelativeTime(props.lastSeen!)}</span>
      </Show>
      <Show when={props.extra}>
        <div class="text-muted text-xs" style="margin-top: 0.25rem">
          <For each={Object.entries(props.extra!)}>
            {([key, value]) => (
              <div>{key}: {String(value)}</div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function QueueCard(props: { name: string; depth: number; processing: number; dead?: number }) {
  const depthClass = () => {
    if (props.depth >= 50) return 'stat-value-down';
    if (props.depth >= 10) return 'stat-value-warning';
    return '';
  };

  return (
    <div class="stat-card">
      <span class="stat-label">{props.name}</span>
      <span class={`stat-value ${depthClass()}`}>{props.depth}</span>
      <span class="text-muted text-xs">
        {props.processing} en cours
        <Show when={props.dead != null && props.dead > 0}>
          {' · '}{props.dead} dead
        </Show>
      </span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function statusFromProcess(processes: ProcessStatus[], name: string): 'ok' | 'down' | 'warning' {
  const p = processes.find((p) => p.name === name);
  if (!p) return 'down';
  return p.alive ? 'ok' : 'down';
}

function lastSeenFromProcess(processes: ProcessStatus[], name: string): string | null {
  return processes.find((p) => p.name === name)?.lastSeenAt ?? null;
}

function extraFromProcess(processes: ProcessStatus[], name: string): Record<string, unknown> | undefined {
  return processes.find((p) => p.name === name)?.extra;
}

function formatDuration(seconds: number | string | null | undefined): string {
  if (seconds == null) return '-';
  const s = typeof seconds === 'string' ? 0 : seconds;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'à l\'instant';
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)}m`;
  return `il y a ${Math.floor(diff / 3_600_000)}h`;
}
