import { createSignal, onMount, Show } from 'solid-js';
import {
  fetchCopyConfig,
  fetchGlobalConfig,
  updateCopyConfig,
  updateGlobalConfig,
} from '../api';
import { useClobCredentials } from '../hooks/useClobCredentials';
import { useTradingWallet } from '../hooks/useTradingWallet';
import { EnvSettingsDialogTrigger } from './dialogs/EnvSettingsDialog';
import { SystemConfigDialog } from './dialogs/SystemConfigDialog';
import { ModeHeroBalanceStat } from './ModeHeroBalanceStat';
import { RealSnapshotDialog } from './dialogs/RealSnapshotDialog';
import { RealPeriodCloseDialog } from './dialogs/RealPeriodCloseDialog';

export function RealHero() {
  const creds = useClobCredentials();
  const { snapshot, refresh: refreshWallet } = useTradingWallet();
  const [realEnabled, setRealEnabled] = createSignal(false);
  const [copyTradingEnabled, setCopyTradingEnabled] = createSignal(false);
  const [systemConfigOpen, setSystemConfigOpen] = createSignal(false);
  const [snapshotOpen, setSnapshotOpen] = createSignal(false);
  const [periodCloseOpen, setPeriodCloseOpen] = createSignal(false);
  const [snapshotSaved, setSnapshotSaved] = createSignal(false);
  async function loadRisk() {
    const [global, copy] = await Promise.all([fetchGlobalConfig(), fetchCopyConfig()]);
    setRealEnabled(global.realTradingEnabled);
    setCopyTradingEnabled(copy.realCopyTradingEnabled);
  }

  onMount(() => {
    void loadRisk();
    void creds.refresh();
  });

  async function toggleReal() {
    const next = !realEnabled();
    if (next && !confirm('Activer le trading réel ? Wallet dédié recommandé.')) return;
    await updateGlobalConfig({ realTradingEnabled: next });
    setRealEnabled(next);
  }

  async function toggleCopyTrading() {
    const next = !copyTradingEnabled();
    try {
      await updateCopyConfig({ realCopyTradingEnabled: next });
      setCopyTradingEnabled(next);
    } catch {
      // Keep UI aligned with DB when PUT fails.
    }
  }

  const balance = () => snapshot();

  function onSnapshotCreated() {
    setSnapshotSaved(true);
    setTimeout(() => setSnapshotSaved(false), 3000);
  }

  return (
    <section class="mode-hero">
      <Show when={creds.needsSetup()}>
        <div class="alert alert-warning" style="margin-bottom: 0.5rem;">
          Les credentials CLOB doivent être configurés dans l'onglet Portefeuille avant d'utiliser le trading réel.
        </div>
      </Show>
      <Show when={creds.needsLiveSetup()}>
        <div class="alert alert-warning" style="margin-bottom: 0.5rem;">
          {creds.blockMessage() ??
            'Configuration live incomplète — vérifiez Portefeuille → Gérer les wallets.'}
        </div>
      </Show>

      <div class="mode-hero-group">
        <ModeHeroBalanceStat
          label={balance()?.label ?? 'Capital wallet'}
          equity={balance()?.equity}
          cash={balance()?.cash}
          positions={balance()?.positions}
          token={balance()?.token}
        />
      </div>

      <div class="mode-hero-divider" />

      <div class="mode-hero-group">
        <div class="mode-hero-stat">
          <span class="mode-hero-label">Trading réel</span>
          <div class="mode-hero-toggle">
            <label class="toggle-switch danger">
              <input
                type="checkbox"
                checked={realEnabled()}
                disabled={!creds.liveReady()}
                onChange={() => void toggleReal()}
              />
              <span class="toggle-track" />
            </label>
            <span class={`badge ${realEnabled() ? 'real' : 'neutral'}`}>
              {realEnabled() ? 'Activé' : 'Désactivé'}
            </span>
          </div>
        </div>
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
            <span class={`badge ${copyTradingEnabled() ? 'real' : 'neutral'}`}>
              {copyTradingEnabled() ? 'Activé' : 'Désactivé'}
            </span>
          </div>
        </div>
        <EnvSettingsDialogTrigger mode="real" />
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => setSnapshotOpen(true)}
        >
          Snapshot
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => setPeriodCloseOpen(true)}
        >
          Clôturer période
        </button>
        {snapshotSaved() && (
          <span class="mode-hero-meta sim-snapshot-saved">Snapshot enregistré</span>
        )}
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => setSystemConfigOpen(true)}
        >
          Config système
        </button>
      </div>
      <SystemConfigDialog
        open={systemConfigOpen()}
        onClose={() => setSystemConfigOpen(false)}
      />
      <RealSnapshotDialog
        open={snapshotOpen()}
        onClose={() => setSnapshotOpen(false)}
        onCreated={onSnapshotCreated}
      />
      <RealPeriodCloseDialog
        open={periodCloseOpen()}
        onClose={() => setPeriodCloseOpen(false)}
        onDone={() => void refreshWallet()}
      />
    </section>
  );
}
