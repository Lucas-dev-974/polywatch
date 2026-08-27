import { createSignal, Show } from 'solid-js';
import { EventsPanel } from '../EventsPanel';
import { ExecutionLog } from '../ExecutionLog';
import { PositionCard } from '../PositionCard';
import { SimAnalyticsPanel } from '../SimAnalyticsPanel';
import { SimHero } from '../sim/SimHero';
import { SIM_PAGE_TABS, UI_KEYS, usePersistedEnum } from '../../lib/ui-persistence';
import type { SimAlgoKind } from '../../lib/simulation';

export function SimulationPage() {
  const [tab, setTab] = usePersistedEnum(UI_KEYS.simTab, 'activity', SIM_PAGE_TABS);
  const [activeAlgo, setActiveAlgo] = createSignal<SimAlgoKind>('crypto');

  return (
    <>
      <SimHero activeAlgo={activeAlgo()} onAlgoChange={setActiveAlgo} />
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
            <PositionCard mode="sim" algoKind={activeAlgo()} />
            <EventsPanel mode="sim" algoKind={activeAlgo()} />
            <ExecutionLog mode="sim" algoKind={activeAlgo()} />
          </div>
        </div>
      </Show>
      <Show when={tab() === 'analytics'}>
        <div class="page-grid page-grid-single">
          <div class="page-col">
            <SimAnalyticsPanel algoKind={activeAlgo()} />
          </div>
        </div>
      </Show>
    </>
  );
}
