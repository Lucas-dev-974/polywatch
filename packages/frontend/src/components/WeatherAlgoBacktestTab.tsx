import { createSignal, Show, onMount } from 'solid-js';
import {
  cancelBacktestRun,
  deleteBacktestRun,
  fetchBacktestDataCoverage,
  fetchBacktestEquity,
  fetchBacktestExcludedTicks,
  fetchBacktestMarketSeries,
  fetchBacktestPositions,
  fetchBacktestRun,
  fetchBacktestRuns,
  fetchLiveMarketSeries,
  fetchWeatherStrategyCatalog,
  launchBacktestRun,
  type BacktestDataCoverage,
  type BacktestEquityPointDto,
  type BacktestExcludedTickDto,
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
import { BacktestLiveRidgePanel } from './backtest/BacktestLiveRidgePanel';
import { useBacktestPolling } from './backtest/useBacktestPolling';

const PAGE_SIZE = 20;
// Taille de page pour le chargement paginé des séries marché (ridge plot).
// Bornée par MAX_MARKETS_SERIES côté backend.
const MARKETS_PAGE_SIZE = 500;

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
  const [excludedTicks, setExcludedTicks] = createSignal<BacktestExcludedTickDto[]>([]);
  const [positions, setPositions] = createSignal<BacktestPositionDto[]>([]);
  const [marketSeries, setMarketSeries] = createSignal<BacktestMarketSeriesDto[]>([]);
  const [marketTotal, setMarketTotal] = createSignal(0);
  const [marketLoading, setMarketLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);

  // ── Ridge plot live (toutes les données marché) ───────────────────────
  const [liveSeries, setLiveSeries] = createSignal<BacktestMarketSeriesDto[]>([]);
  const [liveTotal, setLiveTotal] = createSignal(0);
  const [liveWindow, setLiveWindow] = createSignal<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [liveLoading, setLiveLoading] = createSignal(false);
  const [liveError, setLiveError] = createSignal<string | null>(null);

  const polling = useBacktestPolling(() => {
    const id = selectedId();
    if (id != null) void refreshDetail(id);
    void refreshList();
  });

  const livePolling = useBacktestPolling(() => {
    void refreshLiveSeries();
  });

  async function refreshLiveSeries() {
    setLiveLoading(true);
    try {
      const fid = fidelityMinutes() ? Number(fidelityMinutes()) : undefined;
      const items: BacktestMarketSeriesDto[] = [];
      let total = 0;
      let offset = 0;
      let window: { from: string | null; to: string | null } = { from: null, to: null };
      // Boucle paginée : on concatène les pages jusqu'à avoir tout le total.
      for (;;) {
        const res = await fetchLiveMarketSeries({
          fidelityMinutes: fid,
          offset,
          limit: MARKETS_PAGE_SIZE,
        });
        items.push(...res.items);
        total = res.total;
        window = res.window;
        offset += res.items.length;
        if (offset >= total || res.items.length === 0) break;
      }
      setLiveSeries(items);
      setLiveTotal(total);
      setLiveWindow(window);
      setLiveError(null);
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Données marché indisponibles');
    } finally {
      setLiveLoading(false);
    }
  }

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
    try {
      const run = await fetchBacktestRun(id);
      setDetail(run);
      // Arrêt du polling quand le run est dans un état terminal.
      if (
        run.status === 'completed' ||
        run.status === 'cancelled' ||
        run.status === 'failed'
      ) {
        stopPolling();
      }
      if (run.status === 'completed') {
        const [eq, pos] = await Promise.all([
          fetchBacktestEquity(id),
          fetchBacktestPositions(id, { limit: 200 }),
        ]);
        setEquity(eq.points);
        setPositions(pos.items);
        // Marchés : boucle paginée pour tout récupérer (pas de troncature silencieuse).
        const mktItems: BacktestMarketSeriesDto[] = [];
        let mktTotal = 0;
        let mktOffset = 0;
        setMarketLoading(true);
        try {
          for (;;) {
            const mkt = await fetchBacktestMarketSeries(id, {
              offset: mktOffset,
              limit: MARKETS_PAGE_SIZE,
            });
            mktItems.push(...mkt.items);
            mktTotal = mkt.total;
            mktOffset += mkt.items.length;
            if (mktOffset >= mktTotal || mkt.items.length === 0) break;
          }
          setMarketSeries(mktItems);
          setMarketTotal(mktTotal);
        } finally {
          setMarketLoading(false);
        }
        // Les ticks exclus sont décoratifs : une erreur ici ne doit pas faire
        // échouer le chargement du détail (positions/marchés restent visibles).
        try {
          const exc = await fetchBacktestExcludedTicks(id);
          setExcludedTicks(exc.ticks);
        } catch {
          setExcludedTicks([]);
        }
      } else {
        setEquity([]);
        setPositions([]);
        setMarketSeries([]);
        setMarketTotal(0);
        setMarketLoading(false);
        setExcludedTicks([]);
      }
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Détail indisponible');
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
    void refreshLiveSeries();
    livePolling.start();
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
      setDetail(null);
      setEquity([]);
      setExcludedTicks([]);
      setPositions([]);
      setMarketSeries([]);
      setMarketTotal(0);
      setMarketLoading(false);
      await Promise.all([refreshDetail(res.id), refreshList(0)]);
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
    setExcludedTicks([]);
    setPositions([]);
    setMarketSeries([]);
    setMarketTotal(0);
    setMarketLoading(false);
    void refreshDetail(id);
    startPolling();
  }

  function closeRun() {
    setSelectedId(null);
    setDetail(null);
    setEquity([]);
    setExcludedTicks([]);
    setPositions([]);
    setMarketSeries([]);
    setMarketTotal(0);
    setMarketLoading(false);
    stopPolling();
    void refreshLiveSeries();
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
        <BacktestLiveRidgePanel
          series={liveSeries()}
          total={liveTotal()}
          window={liveWindow()}
          loading={liveLoading()}
          error={liveError()}
        />
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
          excludedTicks={excludedTicks()}
          positions={positions()}
          marketSeries={marketSeries()}
          marketTotal={marketTotal()}
          marketLoading={marketLoading()}
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
