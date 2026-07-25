import { createEffect, createSignal, Show, onMount, onCleanup, on } from 'solid-js';

import { isLoggedIn, clearTokens, onSessionExpired, refreshSessionTokens } from './api';

import { disconnectSocket, connectSocket } from './socket';

import { Login } from './components/Login';

import { WatchlistEditor } from './components/WatchlistEditor';
import { PositionCard } from './components/PositionCard';

import { RealHero } from './components/RealHero';
import { SimulationPage } from './components/SimulationPage';

import { ExecutionLog } from './components/ExecutionLog';

import { EventsPanel } from './components/EventsPanel';

import { NotificationCenter } from './components/NotificationCenter';
import { MarketChartDialogHost } from './components/MarketChartDialogHost';

import { Leaderboard } from './components/Leaderboard';
import { CountdownProvider } from './components/CountdownContext';
import { MarketsPage } from './components/MarketsPage';
import { WalletPage } from './components/WalletPage';
import { CryptoAlgoPage } from './components/CryptoAlgoPage';
import { WeatherAlgoPage } from './components/WeatherAlgoPage';
import { SystemPage } from './components/SystemPage';
import { NavClock } from './components/NavClock';
import {
  APP_PAGES,
  isLegacySystemPage,
  readPersisted,
  SIM_PAGE_TABS,
  SYSTEM_PAGE_TABS,
  UI_KEYS,
  usePersistedEnum,
} from './lib/ui-persistence';
import { closeMarketChart } from './stores/marketChartStore';

export function App() {
  const [loggedIn, setLoggedIn] = createSignal(isLoggedIn());
  const [page, setPage] = usePersistedEnum(UI_KEYS.page, 'simulation', APP_PAGES);
  const [, setSimTab] = usePersistedEnum(UI_KEYS.simTab, 'activity', SIM_PAGE_TABS);
  const [, setSystemTab] = usePersistedEnum(UI_KEYS.systemTab, 'reports', SYSTEM_PAGE_TABS);
  const [cryptoAlgoFullPage, setCryptoAlgoFullPage] = createSignal(false);

  function openSimAnalytics() {
    setPage('simulation');
    setSimTab('analytics');
  }

  function openSystemReports() {
    setPage('system');
    setSystemTab('reports');
  }

  function handleLogin() {
    setLoggedIn(true);
    connectSocket();
  }

  function handleLogout() {
    clearTokens();
    disconnectSocket();
    setLoggedIn(false);
  }

  createEffect(() => {
    if (page() !== 'crypto-algo') {
      setCryptoAlgoFullPage(false);
    }
  });

  createEffect(on(page, () => closeMarketChart()));

  onMount(() => {
    const unsubscribe = onSessionExpired(handleLogout);
    onCleanup(unsubscribe);
    // The access token lives in memory only — restore it after a reload so
    // the first REST/WS calls are authenticated.
    if (isLoggedIn()) void refreshSessionTokens();

    const legacyPage = readPersisted(UI_KEYS.page, 'simulation', (value): value is string =>
      typeof value === 'string',
    );
    if (isLegacySystemPage(legacyPage)) {
      setPage('system');
      setSystemTab(legacyPage);
    }

    const legacySimTab = readPersisted(UI_KEYS.simTab, 'activity', (value): value is string =>
      typeof value === 'string',
    );
    if (legacySimTab === 'snapshots') {
      setPage('system');
      setSystemTab('snapshots');
      setSimTab('activity');
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && page() === 'crypto-algo' && cryptoAlgoFullPage()) {
        setCryptoAlgoFullPage(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <Show
      when={loggedIn()}
      fallback={<Login onLogin={handleLogin} />}
    >
      <div
        class="app"
        classList={{
          'app--crypto-algo-fullpage':
            page() === 'crypto-algo' && cryptoAlgoFullPage(),
        }}
      >
        <header class="app-header">
          <div class="header-brand">
            <div class="brand">
              <div class="brand-icon">PW</div>
              <div>
                <h1>Polywatch</h1>
                <span class="brand-sub">Copy Trading Monitor</span>
              </div>
            </div>
            <NavClock />
          </div>

          <nav class="app-nav">
            <button
              class={`btn btn-sm ${page() === 'simulation' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('simulation')}
            >
              Simulation
            </button>
            <button
              class={`btn btn-sm ${page() === 'real' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('real')}
            >
              Reel
            </button>
            <button
              class={`btn btn-sm ${page() === 'leaderboard' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('leaderboard')}
            >
              Leaderboard
            </button>
            <button
              class={`btn btn-sm ${page() === 'markets' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('markets')}
            >
              Marchés
            </button>
            <button
              class={`btn btn-sm ${page() === 'wallet' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('wallet')}
            >
              Portefeuille
            </button>
            <button
              class={`btn btn-sm ${page() === 'crypto-algo' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('crypto-algo')}
            >
              Crypto Algo
            </button>
            <button
              class={`btn btn-sm ${page() === 'weather-algo' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('weather-algo')}
            >
              Weather Algo
            </button>
            <button
              class={`btn btn-sm ${page() === 'system' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setPage('system')}
            >
              Système
            </button>
          </nav>

          <div class="header-actions">
            <WatchlistEditor />
            <NotificationCenter />
            <button class="btn btn-ghost btn-sm" onClick={handleLogout}>
              Déconnexion
            </button>
          </div>
        </header>

        <MarketChartDialogHost />

        <Show when={page() === 'simulation'}>
          <main class="page page-simulation">
            <SimulationPage />
          </main>
        </Show>

        <Show when={page() === 'real'}>
          <main class="page page-real">
            <RealHero />
            <div class="page-grid page-grid-single">
              <div class="page-col">
                <PositionCard mode="real" />
                <EventsPanel mode="real" />
                <ExecutionLog mode="real" />
              </div>
            </div>
          </main>
        </Show>

        <Show when={page() === 'leaderboard'}>
          <main class="page page-leaderboard">
            <Leaderboard onOpenSimAnalytics={openSimAnalytics} />
          </main>
        </Show>

        <Show when={page() === 'markets'}>
          <main class="page page-markets">
            <CountdownProvider>
              <MarketsPage />
            </CountdownProvider>
          </main>
        </Show>

        <Show when={page() === 'wallet'}>
          <main class="page page-wallet">
            <WalletPage />
          </main>
        </Show>

        <Show when={page() === 'crypto-algo'}>
          <main class="page page-crypto-algo">
            <CryptoAlgoPage
              fullPage={cryptoAlgoFullPage()}
              onToggleFullPage={() => setCryptoAlgoFullPage((v) => !v)}
              onOpenReports={openSystemReports}
            />
          </main>
        </Show>

        <Show when={page() === 'weather-algo'}>
          <main class="page page-weather-algo">
            <WeatherAlgoPage />
          </main>
        </Show>

        <Show when={page() === 'system'}>
          <SystemPage />
        </Show>
      </div>
    </Show>
  );
}
