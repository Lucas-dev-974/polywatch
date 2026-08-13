import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import {
  cancelBacktestRun,
  deleteBacktestRun,
  fetchBacktestDataCoverage,
  fetchBacktestEquity,
  fetchBacktestPositions,
  fetchBacktestRun,
  fetchBacktestRuns,
  fetchWeatherStrategyCatalog,
  launchBacktestRun,
  type BacktestDataCoverage,
  type BacktestEquityPointDto,
  type BacktestPositionDto,
  type BacktestRunDto,
  type WeatherStrategyMeta,
} from '../api';
import { UI_KEYS, usePersistedSignal } from '../lib/ui-persistence';
import { BacktestEquityChart } from './BacktestEquityChart';
import { Pagination } from './Pagination';
import { formatNum, formatTs } from '../lib/format';
import { EXIT_REASON_LABEL } from '@polywatch/core/backtest/exit-reasons';

const PAGE_SIZE = 20;
const POLL_MS = 4000;

/** Stratégies affichées quand le catalogue n'est pas encore chargé (R3). */
const FALLBACK_STRATEGIES = [
  { id: 'weather-forecast', label: 'Forecast (best edge)' },
  { id: 'weather-forecast-aligned', label: 'Forecast (aligned)' },
];

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtUsd(value: number | null | undefined): string {
  return formatNum(value, 2);
}

/** Capital from a completed/selected run — never trust form state for the equity chart. */
function resolveRunCapital(params: Record<string, unknown> | null | undefined): number {
  const n = Number(params?.capital);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function fmtHolding(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const h = ms / 3_600_000;
  if (h >= 1) return `${h.toFixed(1)} h`;
  const m = ms / 60_000;
  return `${m.toFixed(0)} min`;
}

export function WeatherAlgoBacktestTab() {
  // ── Coverage (disponibilité des données) ─────────────────────────
  const [coverage, setCoverage] = createSignal<BacktestDataCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = createSignal(true);

  // ── Formulaire ───────────────────────────────────────────────────
  const [mode, setMode] = createSignal<'reevaluate' | 'replay'>('reevaluate');
  const [from, setFrom] = createSignal('');
  const [to, setTo] = createSignal('');
  const [cities, setCities] = createSignal('');
  const [capital, setCapital] = createSignal('1000');
  const [entryUsdc, setEntryUsdc] = createSignal('10');
  const [slippageBps, setSlippageBps] = createSignal('50');
  const [maxPos, setMaxPos] = createSignal('10');
  const [fidelityMinutes, setFidelityMinutes] = usePersistedSignal(
    'polywatch_weather_algo_backtest_fidelity',
    '',
    (v): v is string => typeof v === 'string',
  );
  const [label, setLabel] = createSignal('');
  const [strategyId, setStrategyId] = usePersistedSignal(
    'polywatch_weather_algo_backtest_strategy_id',
    'weather-forecast',
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  const [executionMode, setExecutionMode] = usePersistedSignal(
    'polywatch_weather_algo_backtest_execution_mode',
    'strategy' as 'strategy' | 'runner-sim',
    (v): v is 'strategy' | 'runner-sim' => v === 'strategy' || v === 'runner-sim',
  );
  const [catalog, setCatalog] = createSignal<WeatherStrategyMeta[]>([]);
  const [launching, setLaunching] = createSignal(false);
  const [launchError, setLaunchError] = createSignal<string | null>(null);

  // ── Liste des runs ───────────────────────────────────────────────
  const [runs, setRuns] = createSignal<BacktestRunDto[]>([]);
  const [listTotal, setListTotal] = createSignal(0);
  const [listLoading, setListLoading] = createSignal(false);
  const [page, setPage] = usePersistedSignal(
    UI_KEYS.weatherAlgoBacktestPage,
    0,
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  );

  // ── Détail d'un run ──────────────────────────────────────────────
  const [selectedId, setSelectedId] = usePersistedSignal<number | null>(
    UI_KEYS.weatherAlgoBacktestSelectedId,
    null,
    (value): value is number | null =>
      value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0),
  );
  const [detail, setDetail] = createSignal<BacktestRunDto | null>(null);
  const [equity, setEquity] = createSignal<BacktestEquityPointDto[]>([]);
  const [positions, setPositions] = createSignal<BacktestPositionDto[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshCoverage() {
    try {
      const cov = await fetchBacktestDataCoverage(
        fidelityMinutes() ? Number(fidelityMinutes()) : undefined,
      );
      setCoverage(cov);
      if (!from()) setFrom(toDateInputValue(cov.from));
      if (!to()) setTo(toDateInputValue(cov.to));
    } catch {
      /* ignore */
    } finally {
      setCoverageLoading(false);
    }
  }

  async function refreshList(pageOverride?: number) {
    const idx = pageOverride ?? page();
    setListLoading(true);
    try {
      const res = await fetchBacktestRuns({ limit: PAGE_SIZE, offset: idx * PAGE_SIZE });
      setRuns(res.items);
      setListTotal(res.total);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Liste indisponible');
    }
    setListLoading(false);
  }

  async function refreshDetail(id: number) {
    setDetailLoading(true);
    try {
      const run = await fetchBacktestRun(id);
      setDetail(run);
      if (run.status === 'completed') {
        const [eq, pos] = await Promise.all([
          fetchBacktestEquity(id),
          fetchBacktestPositions(id, { limit: 200 }),
        ]);
        setEquity(eq.points);
        setPositions(pos.items);
      } else {
        setEquity([]);
        setPositions([]);
      }
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Détail indisponible');
    } finally {
      setDetailLoading(false);
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      const id = selectedId();
      if (id != null) void refreshDetail(id);
      void refreshList();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  onMount(() => {
    void refreshCoverage();
    void refreshList();
    void fetchWeatherStrategyCatalog()
      .then((res) => setCatalog(res.strategies))
      .catch(() => setCatalog([]));
    const restoredId = selectedId();
    if (restoredId != null) {
      openRun(restoredId);
    }
  });

  onCleanup(() => {
    stopPolling();
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (!from() || !to()) {
      setLaunchError('Sélectionnez une plage de dates');
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await launchBacktestRun({
        mode: mode(),
        from: new Date(`${from()}T00:00:00.000Z`).toISOString(),
        to: new Date(`${to()}T23:59:59.999Z`).toISOString(),
        cities: cities().trim() ? cities().split(',').map((c) => c.trim()).filter(Boolean) : undefined,
        strategyId: strategyId(),
        backtestExecutionMode: executionMode(),
        capital: Number(capital()) || 1000,
        entryUsdc: Number(entryUsdc()) || 10,
        slippageBps: Number(slippageBps()) || 0,
        maxConcurrentPositions: Number(maxPos()) || 10,
        fidelityMinutes: fidelityMinutes() ? Number(fidelityMinutes()) : undefined,
        label: label().trim() || undefined,
      });
      setPage(0);
      setSelectedId(res.id);
      await refreshList(0);
      startPolling();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec du lancement';
      setLaunchError(msg.includes('run_already_active') ? 'Un backtest est déjà en cours.' : msg);
    }
    setLaunching(false);
  }

  function openRun(id: number) {
    setSelectedId(id);
    setDetail(null);
    setEquity([]);
    setPositions([]);
    void refreshDetail(id);
    startPolling();
  }

  function closeRun() {
    setSelectedId(null);
    setDetail(null);
    setEquity([]);
    setPositions([]);
    stopPolling();
  }

  async function doCancel(id: number) {
    try {
      await cancelBacktestRun(id);
      await refreshDetail(id);
      await refreshList();
    } catch {
      /* ignore */
    }
  }

  async function doDelete(id: number) {
    if (!confirm(`Supprimer le backtest #${id} et ses positions/equity ?`)) return;
    try {
      await deleteBacktestRun(id);
      if (selectedId() === id) closeRun();
      await refreshList();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Suppression impossible';
      setDetailError(
        msg.includes('run_still_active')
          ? 'Impossible de supprimer un run en cours — annulez-le d’abord.'
          : msg,
      );
    }
  }

  function goToPage(next: number) {
    setPage(next);
    void refreshList(next);
  }

  const pageCount = () => Math.max(1, Math.ceil(listTotal() / PAGE_SIZE));
  const selectedRun = () => detail();

  return (
    <div class="backtest-tab">
      <Show when={selectedRun() == null}>
        {/* ── Formulaire de lancement ── */}
        <form class="backtest-form" onSubmit={submit}>
          <h3 class="settings-subheading">Lancer un backtest</h3>
          <Show when={coverage()}>
            <div class="backtest-coverage">
              <span>
                Données dispo : <strong>{coverage()?.from ? formatTs(coverage()!.from) : '—'}</strong> →{' '}
                <strong>{coverage()?.to ? formatTs(coverage()!.to) : '—'}</strong>
              </span>
              <span>
                Ticks : <strong>{(coverage()?.totalTicks ?? 0).toLocaleString()}</strong>
              </span>
              <span>Villes : <strong>{coverage()?.cities.join(', ') || '—'}</strong></span>
            </div>
          </Show>
          <Show when={coverageLoading()}>
            <p class="form-hint">Chargement de la couverture de données…</p>
          </Show>

          <div class="backtest-form-grid">
            <label class="backtest-field">
              <span>Mode</span>
              <select
                value={mode()}
                onChange={(e) => setMode(e.currentTarget.value as 'reevaluate' | 'replay')}
              >
                <option value="reevaluate">Re-évaluer (relance la stratégie)</option>
                <option value="replay">Rejouer (décisions enregistrées)</option>
              </select>
            </label>
            <label class="backtest-field">
              <span>Du</span>
              <input type="date" value={from()} onInput={(e) => setFrom(e.currentTarget.value)} />
            </label>
            <label class="backtest-field">
              <span>Au</span>
              <input type="date" value={to()} onInput={(e) => setTo(e.currentTarget.value)} />
            </label>
            <label class="backtest-field">
              <span>Villes (séparées par virgule, optionnel)</span>
              <input
                type="text"
                value={cities()}
                onInput={(e) => setCities(e.currentTarget.value)}
                placeholder="ex. london, paris"
              />
            </label>
            <label class="backtest-field">
              <span>Stratégie</span>
              <select
                value={strategyId()}
                onChange={(e) => setStrategyId(e.currentTarget.value)}
              >
                <For each={catalog()}>
                  {(s) => <option value={s.id}>{s.label}</option>}
                </For>
                <Show when={catalog().length === 0}>
                  <For each={FALLBACK_STRATEGIES}>
                    {(s) => <option value={s.id}>{s.label}</option>}
                  </For>
                </Show>
              </select>
            </label>
            <label class="backtest-field">
              <span>Exécution backtest</span>
              <select
                value={executionMode()}
                onChange={(e) =>
                  setExecutionMode(e.currentTarget.value as 'strategy' | 'runner-sim')
                }
              >
                <option value="strategy">Strategy (tick par bucket, rapide)</option>
                <option value="runner-sim">Runner-sim (groupe + dedup, proche live)</option>
              </select>
            </label>
            <label class="backtest-field">
              <span>Capital initial (USDC)</span>
              <input type="number" min="1" value={capital()} onInput={(e) => setCapital(e.currentTarget.value)} />
            </label>
            <label class="backtest-field">
              <span>Entry / position (USDC)</span>
              <input type="number" min="0" value={entryUsdc()} onInput={(e) => setEntryUsdc(e.currentTarget.value)} />
            </label>
            <label class="backtest-field">
              <span>Slippage (bps)</span>
              <input type="number" min="0" value={slippageBps()} onInput={(e) => setSlippageBps(e.currentTarget.value)} />
            </label>
            <label class="backtest-field">
              <span>Max positions concurrentes</span>
              <input type="number" min="1" value={maxPos()} onInput={(e) => setMaxPos(e.currentTarget.value)} />
            </label>
            <label class="backtest-field">
              <span>Intervalle (min, optionnel)</span>
              <input
                type="number"
                min="1"
                placeholder="vide = tous"
                value={fidelityMinutes()}
                onInput={(e) => {
                  setFidelityMinutes(e.currentTarget.value);
                  void refreshCoverage();
                }}
                title="Filtre les ticks par intervalle de fidelity (15 = 15 min). Vide = tous les intervalles."
              />
            </label>
            <label class="backtest-field backtest-field-wide">
              <span>Libellé (optionnel)</span>
              <input type="text" value={label()} onInput={(e) => setLabel(e.currentTarget.value)} />
            </label>
          </div>
          <Show when={launchError()}>
            <p class="form-hint weather-settings-error">{launchError()}</p>
          </Show>
          <div class="backtest-form-actions">
            <button type="submit" class="btn btn-sm btn-primary" disabled={launching()}>
              {launching() ? 'Lancement…' : 'Lancer le backtest'}
            </button>
          </div>
        </form>

        {/* ── Liste des runs ── */}
        <div class="backtest-list">
          <div class="backtest-list-header">
            <h3 class="settings-subheading">Runs</h3>
            <span class="algo-panel-count">{listTotal().toLocaleString()} run(s)</span>
          </div>
          <Show when={listLoading() && runs().length === 0}>
            <p class="form-hint">Chargement…</p>
          </Show>
          <Show when={runs().length === 0 && !listLoading()}>
            <p class="form-hint">Aucun backtest pour l’instant.</p>
          </Show>
          <div class="backtest-run-cards">
            <For each={runs()}>
              {(run) => <RunCard run={run} onOpen={() => openRun(run.id)} />}
            </For>
          </div>
          <Show when={listTotal() > PAGE_SIZE}>
            <Pagination
              page={page()}
              pageCount={pageCount()}
              onPage={goToPage}
            />
          </Show>
        </div>
      </Show>

      <Show when={selectedRun() != null}>
        <RunDetail
          run={selectedRun()!}
          equity={equity()}
          positions={positions()}
          loading={detailLoading()}
          error={detailError()}
          capital={resolveRunCapital(selectedRun()!.params)}
          onBack={closeRun}
          onCancel={() => void doCancel(selectedRun()!.id)}
          onDelete={() => void doDelete(selectedRun()!.id)}
        />
      </Show>
    </div>
  );
}

function RunCard(props: { run: BacktestRunDto; onOpen: () => void }) {
  const run = props.run;
  const statusLabel: Record<string, string> = {
    queued: 'File',
    running: 'En cours',
    completed: 'Terminé',
    failed: 'Échec',
    cancelled: 'Annulé',
  };
  return (
    <button type="button" class="backtest-run-card" onClick={props.onOpen}>
      <div class="backtest-run-card-top">
        <span class="backtest-run-id">#{run.id}</span>
        <span class={`backtest-status backtest-status--${run.status}`}>
          {statusLabel[run.status] ?? run.status}
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

function RunDetail(props: {
  run: BacktestRunDto;
  equity: BacktestEquityPointDto[];
  positions: BacktestPositionDto[];
  loading: boolean;
  error: string | null;
  capital: number;
  onBack: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
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
