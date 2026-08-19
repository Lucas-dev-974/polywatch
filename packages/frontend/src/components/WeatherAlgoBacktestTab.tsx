import { createSignal, Show, onMount } from 'solid-js';
import {
  cancelBacktestRun,
  deleteBacktestRun,
  fetchBacktestDataCoverage,
  fetchBacktestEquity,
  fetchBacktestMarketSeries,
  fetchBacktestPositions,
  fetchBacktestRun,
  fetchBacktestRuns,
  fetchWeatherStrategyCatalog,
  launchBacktestRun,
  type BacktestDataCoverage,
  type BacktestEquityPointDto,
  type BacktestMarketSeriesDto,
  type BacktestPositionDto,
  type BacktestRunDto,
  type BacktestRunParamsInput,
  type WeatherStrategyMeta,
} from '../api';
import { UI_KEYS, usePersistedSignal } from '../lib/ui-persistence';
import { toDateInputValue, resolveRunCapital } from './backtest/format';
import { LaunchBacktestForm } from './backtest/LaunchBacktestForm';
import { BacktestRunList } from './backtest/BacktestRunList';
import { BacktestRunDetail } from './backtest/BacktestRunDetail';
import { useBacktestPolling } from './backtest/useBacktestPolling';

const PAGE_SIZE = 20;

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
  const [marketSeries, setMarketSeries] = createSignal<BacktestMarketSeriesDto[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);

  const polling = useBacktestPolling(() => {
    const id = selectedId();
    if (id != null) void refreshDetail(id);
    void refreshList();
  });

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
        const [eq, pos, mkt] = await Promise.all([
          fetchBacktestEquity(id),
          fetchBacktestPositions(id, { limit: 200 }),
          fetchBacktestMarketSeries(id),
        ]);
        setEquity(eq.points);
        setPositions(pos.items);
        setMarketSeries(mkt.items);
      } else {
        setEquity([]);
        setPositions([]);
        setMarketSeries([]);
      }
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Détail indisponible');
    } finally {
      setDetailLoading(false);
    }
  }

  function startPolling() {
    polling.start();
  }

  function stopPolling() {
    polling.stop();
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

  async function submit(e: Event) {
    e.preventDefault();
    if (!from() || !to()) {
      setLaunchError('Sélectionnez une plage de dates');
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    try {
      const body: BacktestRunParamsInput = {
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
      };
      const res = await launchBacktestRun(body);
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
    setMarketSeries([]);
    void refreshDetail(id);
    startPolling();
  }

  function closeRun() {
    setSelectedId(null);
    setDetail(null);
    setEquity([]);
    setPositions([]);
    setMarketSeries([]);
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
        <LaunchBacktestForm
          coverage={coverage}
          coverageLoading={coverageLoading}
          catalog={catalog}
          mode={mode}
          setMode={setMode}
          from={from}
          setFrom={setFrom}
          to={to}
          setTo={setTo}
          cities={cities}
          setCities={setCities}
          capital={capital}
          setCapital={setCapital}
          entryUsdc={entryUsdc}
          setEntryUsdc={setEntryUsdc}
          slippageBps={slippageBps}
          setSlippageBps={setSlippageBps}
          maxPos={maxPos}
          setMaxPos={setMaxPos}
          fidelityMinutes={fidelityMinutes}
          setFidelityMinutes={setFidelityMinutes}
          label={label}
          setLabel={setLabel}
          strategyId={strategyId}
          setStrategyId={setStrategyId}
          executionMode={executionMode}
          setExecutionMode={setExecutionMode}
          launching={launching}
          launchError={launchError}
          onFidelityChange={() => void refreshCoverage()}
          onSubmit={submit}
        />
        <BacktestRunList
          runs={runs()}
          total={listTotal()}
          loading={listLoading()}
          page={page()}
          pageCount={pageCount()}
          onOpen={openRun}
          onPage={goToPage}
        />
      </Show>

      <Show when={selectedRun() != null}>
        <BacktestRunDetail
          run={selectedRun()!}
          equity={equity()}
          positions={positions()}
          marketSeries={marketSeries()}
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
