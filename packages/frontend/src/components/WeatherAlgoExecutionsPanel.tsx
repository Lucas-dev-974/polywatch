import { For, Show, createSignal } from 'solid-js';
import { api } from '../api';

interface Execution {
  id: number;
  copiedPositionId: number;
  side: string;
  reason: string | null;
  status: string;
  mode: string;
  executedAt: string | null;
}

export function WeatherAlgoExecutionsPanel() {
  const [executions, setExecutions] = createSignal<Execution[]>([]);
  const [loading, setLoading] = createSignal(true);

  async function load() {
    try {
      const data = await api<{ items: Execution[]; total: number }>('/executions?limit=50');
      // Execution doesn't have traderAddress — filter by reason prefix.
      setExecutions(data.items.filter((e) =>
        e.reason != null && e.reason.startsWith('WEATHER_')
      ));
    } catch { /* ignore */ }
    setLoading(false);
  }

  void load();

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">Exécutions</h2>
        <button class="btn btn-sm btn-ghost" onClick={() => load()}>Rafraîchir</button>
      </div>
      <Show when={!loading()} fallback={<div class="algo-empty">Chargement…</div>}>
        <Show when={executions().length > 0} fallback={<div class="algo-empty">Aucune exécution.</div>}>
          <div class="algo-exec-list">
            <For each={executions()}>
              {(ex) => (
                <div class="algo-exec-row">
                  <span>{ex.executedAt ? new Date(ex.executedAt).toLocaleString() : '—'}</span>
                  <span>{ex.side}</span>
                  <span>{ex.reason}</span>
                  <span>{ex.status}</span>
                  <span>{ex.mode}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}