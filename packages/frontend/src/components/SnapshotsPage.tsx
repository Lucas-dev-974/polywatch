import { Show } from 'solid-js';
import { SimulationSnapshotsPanel } from './SimulationSnapshotsPanel';
import { RealSnapshotsPanel } from './RealSnapshotsPanel';
import {
  SNAPSHOTS_PAGE_MODES,
  UI_KEYS,
  usePersistedEnum,
} from '../lib/ui-persistence';

export function SnapshotsPage() {
  const [mode, setMode] = usePersistedEnum(
    UI_KEYS.snapshotsMode,
    'sim',
    SNAPSHOTS_PAGE_MODES,
  );

  return (
    <div class="system-tab-content page-snapshots">
      <p class="page-header-sub system-tab-intro">
        Historique longitudinal — sessions, snapshots et comparaison par mode.
      </p>

      <div class="sim-page-tabs panel-tabs snapshots-mode-tabs">
        <button
          type="button"
          class={`panel-tab ${mode() === 'sim' ? 'active' : ''}`}
          onClick={() => setMode('sim')}
        >
          Simulation
        </button>
        <button
          type="button"
          class={`panel-tab ${mode() === 'real' ? 'active' : ''}`}
          onClick={() => setMode('real')}
        >
          Réel
        </button>
      </div>

      <Show when={mode() === 'sim'}>
        <div class="page-grid page-grid-single">
          <div class="page-col">
            <SimulationSnapshotsPanel />
          </div>
        </div>
      </Show>

      <Show when={mode() === 'real'}>
        <div class="page-grid page-grid-single">
          <div class="page-col">
            <RealSnapshotsPanel />
          </div>
        </div>
      </Show>
    </div>
  );
}
