import { createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { fetchCopyConfig, updateCopyConfig } from '../../api';
import { debounceFn } from '../../lib/debounce';
import {
  fetchSimBalance,
  type SimBalance,
  type SimAlgoKind,
} from '../../lib/simulation';
import { connectSocket } from '../../socket';
import { EnvSettingsDialogTrigger } from '../dialogs/EnvSettingsDialog';
import { SystemConfigDialog } from '../dialogs/SystemConfigDialog';
import { SimExecutionSettingsDialog } from '../dialogs/SimExecutionSettingsDialog';
import { formatSimExecutionStatsSummary } from '../SimExecutionStatsPanel';
import { ModeHeroBalanceStat } from '../ModeHeroBalanceStat';
import { SimSnapshotDialog } from '../dialogs/SimSnapshotDialog';
import { NewSessionResetDialog } from '../dialogs/NewSessionResetDialog';
import { Icon } from '../Icon';
import {
  fetchSimExecutionStats,
  type SimExecutionStats,
} from '../settings/sim-execution-settings-types';

/** Coalesce bursty pnl_tick bursts before refetching mark-to-market equity. */
const BALANCE_REFRESH_DEBOUNCE_MS = 500;
const EXEC_STATS_REFRESH_DEBOUNCE_MS = 2_000;

const ALGO_TABS: { id: SimAlgoKind; label: string; icon: string }[] = [
  { id: 'crypto', label: 'Crypto', icon: 'trending-up' },
  { id: 'weather', label: 'Weather', icon: 'cloud' },
  { id: 'copy', label: 'Copy', icon: 'copy' },
];

type Props = {
  activeAlgo: SimAlgoKind;
  onAlgoChange: (algo: SimAlgoKind) => void;
};

export function SimHero(props: Props) {
  const [simBalance, setSimBalance] = createSignal<SimBalance | null>(null);
  const [snapshotOpen, setSnapshotOpen] = createSignal(false);
  const [resetDialogOpen, setResetDialogOpen] = createSignal(false);
  const [simExecSettingsOpen, setSimExecSettingsOpen] = createSignal(false);
  const [systemConfigOpen, setSystemConfigOpen] = createSignal(false);
  const [execStats, setExecStats] = createSignal<SimExecutionStats | null>(null);
  const [snapshotSaved, setSnapshotSaved] = createSignal(false);
  const [copyTradingEnabled, setCopyTradingEnabled] = createSignal(false);

  async function loadExecStats() {
    try {
      setExecStats(await fetchSimExecutionStats());
    } catch {
      // Stats unavailable — panel in settings dialog will show the error.
    }
  }

  async function loadRisk() {
    const copy = await fetchCopyConfig();
    setCopyTradingEnabled(copy.simCopyTradingEnabled);
  }

  let balanceLoadGen = 0;

  async function loadSimBalance() {
    const gen = ++balanceLoadGen;
    const ak = props.activeAlgo;
    try {
      const bal = await fetchSimBalance(ak);
      if (gen === balanceLoadGen && ak === props.activeAlgo) {
        setSimBalance(bal);
      }
    } catch {
      // Initial REST load failed — WS pushes will populate the value.
    }
  }

  onMount(() => {
    void loadRisk();
    void loadExecStats();
    const socket = connectSocket();
    const refreshBalance = debounceFn(() => void loadSimBalance(), BALANCE_REFRESH_DEBOUNCE_MS);
    const refreshExecStats = debounceFn(
      () => void loadExecStats(),
      EXEC_STATS_REFRESH_DEBOUNCE_MS,
    );
    const onSimulationReset = (payload?: { algoKind?: string }) => {
      if (payload?.algoKind && payload.algoKind !== props.activeAlgo) return;
      void loadSimBalance();
    };
    socket.on('simulation_balance', (payload: SimBalance & { algoKind?: string }) => {
      if (!payload.algoKind || payload.algoKind !== props.activeAlgo) return;
      setSimBalance(payload);
    });
    socket.on('simulation_reset', onSimulationReset);
    socket.on('pnl_tick', refreshBalance);
    socket.on('position_update', refreshBalance);
    socket.on('execution', refreshExecStats);
    onCleanup(() => {
      socket.off('simulation_balance');
      socket.off('simulation_reset', onSimulationReset);
      socket.off('pnl_tick', refreshBalance);
      socket.off('position_update', refreshBalance);
      socket.off('execution', refreshExecStats);
      refreshBalance.cancel();
      refreshExecStats.cancel();
    });
    void loadSimBalance();
  });

  async function toggleCopyTrading() {
    const next = !copyTradingEnabled();
    try {
      await updateCopyConfig({ simCopyTradingEnabled: next });
      setCopyTradingEnabled(next);
    } catch {
      // Keep UI aligned with DB when PUT fails.
    }
  }

  function openResetDialog() {
    setResetDialogOpen(true);
  }

  function onResetDone(result: SimBalance | null) {
    if (result) setSimBalance(result);
  }

  function onSnapshotCreated() {
    setSnapshotSaved(true);
    setTimeout(() => setSnapshotSaved(false), 3000);
  }

  function switchAlgo(algo: SimAlgoKind) {
    props.onAlgoChange(algo);
    setSimBalance(null);
    void loadSimBalance();
  }

  const balance = () => simBalance();
  const sessionPnl = () => {
    const b = balance();
    const equity = b?.equity;
    const baseline = b?.baselineCapital;
    return equity != null && baseline != null ? equity - baseline : null;
  };

  return (
    <section class="mode-hero">
      <div class="mode-hero-group">
        <nav class="algo-kind-tabs" role="tablist" aria-label="Algo kind">
          <For each={ALGO_TABS}>
            {(tab) => (
              <button
                type="button"
                class="algo-kind-tab"
                classList={{ active: props.activeAlgo === tab.id }}
                role="tab"
                aria-selected={props.activeAlgo === tab.id}
                onClick={() => switchAlgo(tab.id)}
              >
                <Icon name={tab.icon} size={14} />
                <span>{tab.label}</span>
              </button>
            )}
          </For>
        </nav>
        <ModeHeroBalanceStat
          label={`Simulation (${props.activeAlgo})`}
          equity={balance()?.equity}
          cash={balance()?.amount}
          positions={balance()?.positionsValue}
          sessionPnl={sessionPnl()}
          openPnlSum={balance()?.openPnlSum}
          closedPnlSum={balance()?.closedPnlSum}
          token={balance()?.token}
        />
      </div>

      <div class="mode-hero-divider" />

      <div class="mode-hero-group">
        <div class="mode-hero-stat">
          <span class="mode-hero-label">Copy trading</span>
          <div class="mode-hero-toggle">
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={copyTradingEnabled()}
                onChange={() => void toggleCopyTrading()}
              />
              <span class="toggle-track" />
            </label>
          </div>
        </div>
        <EnvSettingsDialogTrigger mode="sim" />
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => setSystemConfigOpen(true)}
        >
          Config système
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => setSimExecSettingsOpen(true)}
        >
          Exécution sim
        </button>
        <Show when={execStats()}>
          {(st) => (
            <span class="mode-hero-meta mono" title="Statistiques exécution (RTT réel / shadow)">
              {formatSimExecutionStatsSummary(st())}
            </span>
          )}
        </Show>
        <button
          class="btn btn-secondary btn-sm"
          onClick={() => setSnapshotOpen(true)}
        >
          Snapshot
        </button>
        <button class="btn btn-secondary btn-sm" onClick={openResetDialog}>
          Réinitialiser
        </button>
        {snapshotSaved() && (
          <span class="mode-hero-meta sim-snapshot-saved">Snapshot enregistré</span>
        )}
      </div>
      <NewSessionResetDialog
        open={resetDialogOpen()}
        onClose={() => setResetDialogOpen(false)}
        mode="manual"
        onDone={(result) => onResetDone(result)}
        algoKind={props.activeAlgo}
      />
      <SimSnapshotDialog
        open={snapshotOpen()}
        onClose={() => setSnapshotOpen(false)}
        onCreated={onSnapshotCreated}
        algoKind={props.activeAlgo}
      />
      <SimExecutionSettingsDialog
        open={simExecSettingsOpen()}
        onClose={() => {
          setSimExecSettingsOpen(false);
          void loadExecStats();
        }}
      />
      <SystemConfigDialog
        open={systemConfigOpen()}
        onClose={() => setSystemConfigOpen(false)}
      />
    </section>
  );
}
