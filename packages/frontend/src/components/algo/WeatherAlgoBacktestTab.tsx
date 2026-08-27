import { createEffect, createSignal, Show, onCleanup, onMount } from 'solid-js';
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
} from '../../api';
import { UI_KEYS, usePersistedSignal } from '../../lib/ui-persistence';
import { toDateInputValue, resolveRunCapital } from '../backtest/format';
import { LaunchBacktestForm } from '../backtest/LaunchBacktestForm';
import { BacktestRunList } from '../backtest/BacktestRunList';
import { BacktestRunDetail } from '../backtest/BacktestRunDetail';
import { BacktestLiveRidgePanel } from '../backtest/BacktestLiveRidgePanel';
import { useBacktestPolling } from '../backtest/useBacktestPolling';
import { clearEnrichCache } from '../backtest/ridge/precompute';

const PAGE_SIZE = 20;
// Taille de page pour le chargement paginé des séries marché (ridge plot).
// Bornée par MAX_MARKETS_SERIES côté backend.
const MARKETS_PAGE_SIZE = 500;
// Borne de sécurité sur les boucles de pagination : 50 pages × 500 = 25 000
// marchés max. Au-delà, on tronque (avec warning implicite) pour éviter une
// boucle infinie si le total croît ou si le backend renvoie une page vide.
const MAX_PAGES = 50;

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
      // '' = "Toutes les stratégies actives" (runner-sim multi-stratégies).
      (v): v is string => typeof v === 'string',
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
  // Seuil de prix YES moyen (0..100) partagé entre le fetch backend et le ridge
  // chart. Le backend applique le filtre (HAVING AVG(yesPrice) > seuil) pour
  // réduire le payload ; le chart l'utilise pour le groupement local.
  const [minAvgYes, setMinAvgYes] = usePersistedSignal(
    UI_KEYS.weatherAlgoBacktestRidgeMinAvgYes,
    20,
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
  );
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

  // AbortController du run courant : annulé à chaque nouveau refreshDetail /
  // openRun / closeRun pour que les réponses d'un run périmé ne résolvent pas
  // après le switch vers un autre run (stale-after-switch).
  let detailAbort: AbortController | null = null;
  function abortDetail() {
    detailAbort?.abort();
    detailAbort = null;
  }

  const polling = useBacktestPolling(async () => {
    const id = selectedId();
    if (id != null) await refreshDetail(id);
    await refreshList();
  });

  // Ridge live pollé à 10 s : le backend cache les agrégats /markets-series
  // pendant 30 s, donc 1 miss cache sur ~3 polls.
  const livePolling = useBacktestPolling(
    async () => {
      await refreshLiveSeries();
    },
    () => true,
    10_000,
  );

  async function refreshLiveSeries() {
    setLiveLoading(true);
    try {
      const fid = fidelityMinutes() ? Number(fidelityMinutes()) : undefined;
      const items: BacktestMarketSeriesDto[] = [];
      let total = 0;
      let offset = 0;
      let window: { from: string | null; to: string | null } = { from: null, to: null };
      // Boucle paginée bornée par MAX_PAGES : on concatène les pages jusqu'à
      // avoir tout le total, sans risque de boucle infinie.
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchLiveMarketSeries({
          fidelityMinutes: fid,
          minAvgYes: minAvgYes() / 100,
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
    abortDetail();
    const controller = new AbortController();
    detailAbort = controller;
    const { signal } = controller;
    try {
      const run = await fetchBacktestRun(id, signal);
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
          fetchBacktestEquity(id, signal),
          fetchBacktestPositions(id, { limit: 200, signal }),
        ]);
        setEquity(eq.points);
        setPositions(pos.items);
        // Marchés : boucle paginée pour tout récupérer (pas de troncature silencieuse).
        const mktItems: BacktestMarketSeriesDto[] = [];
        let mktTotal = 0;
        let mktOffset = 0;
        setMarketLoading(true);
        try {
          for (let page = 0; page < MAX_PAGES; page++) {
            const mkt = await fetchBacktestMarketSeries(id, {
              offset: mktOffset,
              limit: MARKETS_PAGE_SIZE,
              minAvgYes: minAvgYes() / 100,
              signal,
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
          const exc = await fetchBacktestExcludedTicks(id, signal);
          setExcludedTicks(exc.ticks);
        } catch {
          if (signal.aborted) return;
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
      // Un abort provoqué par un switch de run (openRun/closeRun) n'est pas une
      // erreur à afficher : le nouveau refreshDetail va remplacer l'état.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof Error && err.message === 'not_found') {
        // Run introuvable (supprimé ou hors périmètre utilisateur) : on
        // nettoie la sélection persistée pour revenir à la liste.
        closeRun();
        return;
      }
      setDetailError(err instanceof Error ? err.message : 'Détail indisponible');
    }
  }

  function startPolling() {
    polling.start();
  }

  function stopPolling() {
    polling.stop();
  }

  // Re-fetch des séries marché quand le seuil de prix YES moyen change : le
  // backend applique le filtre (HAVING AVG(yesPrice) > seuil), donc on doit
  // recharger les données pour refléter le nouveau seuil.
  createEffect(() => {
    minAvgYes();
    const id = selectedId();
    if (id != null) {
      void refreshDetail(id);
    } else {
      void refreshLiveSeries();
    }
  });

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

  // Vide le cache d'enrichissement (module-level) au démontage pour éviter une
  // fuite mémoire entre sessions de backtest.
  onCleanup(() => clearEnrichCache());

  async function submit(e: Event) {
    e.preventDefault();
    if (!from() || !to()) {
      setLaunchError('Sélectionnez une plage de dates');
      return;
    }
    const cap = Number(capital());
    if (!Number.isFinite(cap) || cap <= 0) {
      setLaunchError('Capital initial invalide (nombre > 0 requis)');
      return;
    }
    const slip = Number(slippageBps());
    if (!Number.isFinite(slip) || slip < 0) {
      setLaunchError('Slippage invalide (nombre ≥ 0 requis)');
      return;
    }
    const entry = Number(entryUsdc());
    if (!Number.isFinite(entry) || entry <= 0) {
      setLaunchError('Entry / position invalide (nombre > 0 requis)');
      return;
    }
    const maxp = Number(maxPos());
    if (!Number.isFinite(maxp) || maxp < 1 || !Number.isInteger(maxp)) {
      setLaunchError('Max positions concurrentes invalide (entier ≥ 1 requis)');
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
              // En mode reevaluate, une stratégie vide = toutes les stratégies
              // actives de la config (runner-sim multi-stratégies). En replay,
              // on force une stratégie cible (filtre data-loader).
              strategyId: strategyId() || (mode() === 'replay' ? 'weather-forecast' : undefined),
              capital: cap,
              entryUsdc: entry,
              slippageBps: slip,
              maxConcurrentPositions: maxp,
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
    abortDetail();
    clearEnrichCache();
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
    abortDetail();
    clearEnrichCache();
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
          minAvgYes={[minAvgYes, setMinAvgYes]}
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
          minAvgYes={[minAvgYes, setMinAvgYes]}
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
