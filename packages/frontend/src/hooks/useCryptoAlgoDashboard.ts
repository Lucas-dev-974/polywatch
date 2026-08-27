import { createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import {
  api,
  fetchCryptoConfig,
  fetchGlobalConfig,
  updateGlobalConfig,
} from '../api';
import { fetchAlgoCapital } from '../lib/algo-capital';
import { deriveCryptoAlgoHealthAlerts } from '../lib/crypto-algo-health';
import {
  filterActiveFutureMarkets,
  filterActiveLiveMarkets,
  filterInactiveLiveMarkets,
  findNearestFutureMarket,
} from '../lib/algo-market-filters';
import { mergeMarketPercentUpdates } from '../lib/algo-market-prices';
import {
  loadAlgoMarkets,
  loadStatus,
  selections,
  type AlgoMarketStatus,
} from '../stores/algoMarketsStore';
import { loadAutoTrackRules, rules } from '../stores/autoTrackStore';
import { useClobCredentials } from './useClobCredentials';
import { useClock } from './useClock';
import type { AlgoMarketsPricesResponse } from '../components/algo/AlgoMarketCard';
import { connectSocket } from '../socket';
import type { MarketPercentUpdate } from '@polywatch/core/market-list';

export interface UseCryptoAlgoDashboardOptions {
  onMarketsChanged?: () => void;
  /** Open-like algo positions for exit-emit block health alerts. */
  exitEmitBlockedPositions?: () => Array<{
    id: number;
    status: string;
    lastExitBlockReason?: string | null;
    lastExitBlockCloseReason?: string | null;
    firstExitBlockAt?: string | null;
    exitEmitBlockedCount?: number | null;
  }>;
}

export function useCryptoAlgoDashboard(options: UseCryptoAlgoDashboardOptions = {}) {
  const creds = useClobCredentials();
  const now = useClock(1_000);

  const [status, setStatus] = createSignal<AlgoMarketStatus | null>(null);
  const [capital, setCapital] = createSignal<Awaited<ReturnType<typeof fetchAlgoCapital>> | null>(
    null,
  );
  const [realTradingEnabled, setRealTradingEnabled] = createSignal(false);
  const [cryptoAlgoEnabled, setCryptoAlgoEnabled] = createSignal<boolean | null>(null);

  const [marketPrices, { refetch: refetchMarketPrices, mutate: mutateMarketPrices }] =
    createResource(async () => api<AlgoMarketsPricesResponse>('/algo/markets-prices'));

  async function refreshStatus() {
    try {
      setStatus(await loadStatus());
    } catch {
      setStatus(null);
    }
  }

  async function loadCapital() {
    try {
      setCapital(await fetchAlgoCapital());
    } catch {
      setCapital(null);
    }
  }

  async function loadRiskFlags() {
    try {
      const [global, crypto] = await Promise.all([fetchGlobalConfig(), fetchCryptoConfig()]);
      setRealTradingEnabled(global.realTradingEnabled);
      setCryptoAlgoEnabled(crypto.cryptoAlgoEnabled);
    } catch {
      setRealTradingEnabled(false);
      setCryptoAlgoEnabled(null);
    }
  }

  async function toggleRealTrading() {
    const next = !realTradingEnabled();
    if (
      next &&
      !confirm(
        'Activer le trading r\u00E9el pour crypto-algo ? Les ordres seront ex\u00E9cut\u00E9s avec de vrais fonds.',
      )
    ) {
      return;
    }
    try {
      await updateGlobalConfig({ realTradingEnabled: next });
      setRealTradingEnabled(next);
    } catch (err) {
      alert(
        err instanceof Error
          ? `\u00C9chec : ${err.message}`
          : "Impossible de modifier le trading r\u00E9el.",
      );
    }
  }

  function refresh() {
    void refreshStatus();
    void loadCapital();
    void refetchMarketPrices();
    void loadRiskFlags();
  }

  const liveMarkets = createMemo(() => marketPrices()?.live ?? []);
  const futureMarkets = createMemo(() => marketPrices()?.future ?? []);
  const activeLiveMarkets = createMemo(() => filterActiveLiveMarkets(liveMarkets()));
  const activeFutureMarkets = createMemo(() =>
    filterActiveFutureMarkets(futureMarkets(), now()),
  );
  const inactiveMarkets = createMemo(() => filterInactiveLiveMarkets(liveMarkets()));
  const nearestFutureMarket = createMemo(() =>
    findNearestFutureMarket(activeFutureMarkets(), now()),
  );

  const enabledSelectionCount = () => selections().filter((s) => s.enabled).length;
  const autoTrackEnabledRuleCount = () => rules().filter((r) => r.enabled).length;

  const healthAlerts = createMemo(() =>
    deriveCryptoAlgoHealthAlerts({
      processAlive: status()?.alive ?? null,
      cryptoAlgoEnabled: cryptoAlgoEnabled(),
      realTradingEnabled: realTradingEnabled(),
      enabledLiveMarketCount: activeLiveMarkets().length,
      enabledSelectionCount: status()?.enabledSelections ?? enabledSelectionCount(),
      selectionsWithMarket: status()?.selectionsWithMarket ?? null,
      evaluableSelections: status()?.evaluableSelections ?? null,
      autoTrackEnabledRuleCount: autoTrackEnabledRuleCount(),
      nearestFutureStartMs: nearestFutureMarket()?.ms ?? null,
      nearestFutureLabel: nearestFutureMarket()?.label ?? null,
      lastSkipReason: status()?.lastSkipReason ?? null,
      exitEmitBlockedPositions: options.exitEmitBlockedPositions?.() ?? [],
      nowMs: now(),
    }),
  );

  onMount(() => {
    void loadAlgoMarkets();
    void loadAutoTrackRules();
    void refreshStatus();
    void loadCapital();
    void loadRiskFlags();
    void creds.refresh();

    const socket = connectSocket();
    const onPctUpdate = (updates: MarketPercentUpdate[]) => {
      mutateMarketPrices((current) => mergeMarketPercentUpdates(current, updates));
    };
    socket.on('market_pct_update', onPctUpdate);

    const onAlgoMarketsChanged = () => {
      void refetchMarketPrices();
      options.onMarketsChanged?.();
    };
    socket.on('algo_markets_changed', onAlgoMarketsChanged);

    onCleanup(() => {
      socket.off('market_pct_update', onPctUpdate);
      socket.off('algo_markets_changed', onAlgoMarketsChanged);
    });
  });

  return {
    creds,
    now,
    status,
    capital,
    realTradingEnabled,
    cryptoAlgoEnabled,
    liveMarkets,
    futureMarkets,
    inactiveMarkets,
    healthAlerts,
    refresh,
    refetchMarketPrices,
    toggleRealTrading,
  };
}
