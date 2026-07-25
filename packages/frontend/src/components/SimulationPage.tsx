import { Show } from 'solid-js';
import { EventsPanel } from './EventsPanel';
import { ExecutionLog } from './ExecutionLog';
import { PositionCard } from './PositionCard';
import { SimAnalyticsPanel } from './SimAnalyticsPanel';
import { SimHero } from './SimHero';
import { SIM_PAGE_TABS, UI_KEYS, usePersistedEnum } from '../lib/ui-persistence';

export function SimulationPage() {
  const [tab, setTab] = usePersistedEnum(UI_KEYS.simTab, 'activity', SIM_PAGE_TABS);

  return (
    <>
      <SimHero />
      <div class="sim-page-tabs panel-tabs">
        <button
          type="button"
          class={`panel-tab ${tab() === 'activity' ? 'active' : ''}`}
          onClick={() => setTab('activity')}
        >
          Activité
        </button>
        <button
          type="button"
          class={`panel-tab ${tab() === 'analytics' ? 'active' : ''}`}
          onClick={() => setTab('analytics')}
        >
          Analytics
        </button>
      </div>
      <Show when={tab() === 'activity'}>
        <div class="page-grid page-grid-single">
          <div class="page-col">
            <PositionCard mode="sim" />
            <EventsPanel mode="sim" />
            <ExecutionLog mode="sim" />
          </div>
        </div>
      </Show>
      <Show when={tab() === 'analytics'}>
        <div class="page-grid page-grid-single">
          <div class="page-col">
            <SimAnalyticsPanel />
          </div>
        </div>
      </Show>
    </>
  );
}
