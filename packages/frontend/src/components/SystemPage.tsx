import { For, Show } from 'solid-js';
import { E2eTestsPage } from './E2eTestsPage';
import { MetricsDashboardPage } from './MetricsDashboardPage';
import { ReportsPage } from './ReportsPage';
import { SnapshotsPage } from './SnapshotsPage';
import { SystemOverviewPage } from './SystemOverviewPage';
import { CryptoAlgoMonitorPage } from './CryptoAlgoMonitorPage';
import {
  SYSTEM_PAGE_TABS,
  type SystemPageTab,
  UI_KEYS,
  usePersistedEnum,
} from '../lib/ui-persistence';

const TAB_LABELS: Record<SystemPageTab, string> = {
  overview: 'Overview',
  reports: 'Rapports',
  snapshots: 'Snapshots',
  'e2e-tests': 'E2E Tests',
  metrics: 'Métriques',
  'crypto-algo-monitor': 'Crypto-Algo Monitor',
};

export function SystemPage() {
  const [tab, setTab] = usePersistedEnum(UI_KEYS.systemTab, 'reports', SYSTEM_PAGE_TABS);

  return (
    <main class="page page-system">
      <header class="page-header">
        <div>
          <h1>Système</h1>
          <p class="page-header-sub">
            Rapports, snapshots, tests E2E et métriques d&apos;exploitation.
          </p>
        </div>
      </header>

      <div class="sim-page-tabs panel-tabs system-page-tabs">
        <For each={[...SYSTEM_PAGE_TABS]}>
          {(id) => (
            <button
              type="button"
              class={`panel-tab ${tab() === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          )}
        </For>
      </div>

      <Show when={tab() === 'overview'}>
        <SystemOverviewPage />
      </Show>
      <Show when={tab() === 'reports'}>
        <ReportsPage />
      </Show>
      <Show when={tab() === 'snapshots'}>
        <SnapshotsPage />
      </Show>
      <Show when={tab() === 'e2e-tests'}>
        <E2eTestsPage />
      </Show>
      <Show when={tab() === 'metrics'}>
        <MetricsDashboardPage />
      </Show>
      <Show when={tab() === 'crypto-algo-monitor'}>
        <CryptoAlgoMonitorPage />
      </Show>
    </main>
  );
}
