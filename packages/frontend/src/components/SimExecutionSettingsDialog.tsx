import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { fetchGlobalConfig, updateGlobalConfig } from '../api';
import { Dialog } from './Dialog';
import { NullableNumberField, ToggleField } from './settings/settings-fields';
import { SimExecutionStatsPanel } from './SimExecutionStatsPanel';
import {
  fetchSimExecutionStats,
  pickSimExecutionFields,
  type SimExecutionSettings,
  type SimExecutionStats,
} from './settings/sim-execution-settings-types';

const STATS_POLL_MS = 15_000;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SimExecutionSettingsDialog(props: Props) {
  const [settings, setSettings] = createSignal<SimExecutionSettings | null>(null);
  const [stats, setStats] = createSignal<SimExecutionStats | null>(null);
  const [statsLoading, setStatsLoading] = createSignal(false);
  const [statsRefreshing, setStatsRefreshing] = createSignal(false);
  const [statsError, setStatsError] = createSignal<string | null>(null);
  const [statsUpdatedAt, setStatsUpdatedAt] = createSignal<number | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function loadSettings() {
    try {
      const config = await fetchGlobalConfig();
      setSettings(pickSimExecutionFields(config));
      setError(null);
    } catch {
      setError('Impossible de charger la configuration.');
    }
  }

  async function loadStats(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!silent) setStatsLoading(true);
    else setStatsRefreshing(true);
    setStatsError(null);
    try {
      const executionStats = await fetchSimExecutionStats();
      setStats(executionStats);
      setStatsUpdatedAt(Date.now());
    } catch {
      setStatsError('Impossible de charger les statistiques live.');
    } finally {
      if (!silent) setStatsLoading(false);
      else setStatsRefreshing(false);
    }
  }

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setError(null);
        setStatsError(null);
        void loadSettings();
        void loadStats();
      },
    ),
  );

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        const timer = setInterval(() => void loadStats({ silent: true }), STATS_POLL_MS);
        onCleanup(() => clearInterval(timer));
      },
    ),
  );

  function patch(patch: Partial<SimExecutionSettings>) {
    const current = settings();
    if (!current) return;
    setSettings({ ...current, ...patch });
  }

  async function save() {
    const current = settings();
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      await updateGlobalConfig(current as unknown as Record<string, unknown>);
      props.onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Échec de l'enregistrement : ${err.message}`
          : "Échec de l'enregistrement.",
      );
    } finally {
      setSaving(false);
    }
  }

  const latencyMode = () => settings()?.simExecLatencyMode ?? 'fixed';

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Réalisme exécution simulation"
      titleId="sim-execution-settings-title"
      class="dialog-settings"
      bodyClass="dialog-body-settings dialog-body-scroll"
    >
      <div class="form-stack">
        <SimExecutionStatsPanel
          stats={stats()}
          loading={statsLoading()}
          error={statsError()}
          lastUpdatedAt={statsUpdatedAt()}
          refreshing={statsRefreshing()}
          onRefresh={() => void loadStats({ silent: true })}
        />

        <Show
          when={settings()}
          fallback={<div class="empty-state">Chargement de la configuration…</div>}
        >
          {(s) => (
            <>
              <p class="form-hint settings-intro">
                Ajuste le comportement de la simulation pour se rapprocher du trading
                réel (latence, course sur la liquidité, préflight wallet, shadow
                logging). Aucun ordre CLOB n’est envoyé en mode sim.
              </p>

              <section class="settings-section settings-section-full">
                <h3 class="settings-section-title">Latence d’exécution</h3>
                <div class="form-field">
                  <label class="form-label" for="sim-exec-latency-mode">
                    Mode
                  </label>
                  <select
                    id="sim-exec-latency-mode"
                    class="form-input"
                    value={latencyMode() === 'calibrated' ? 'calibrated' : 'fixed'}
                    onChange={(e) =>
                      patch({
                        simExecLatencyMode:
                          e.currentTarget.value === 'calibrated'
                            ? 'calibrated'
                            : 'fixed',
                      })
                    }
                  >
                    <option value="fixed">Fixe (ms configurés)</option>
                    <option value="calibrated">
                      Calibrée sur le réel (RTT CLOB)
                    </option>
                  </select>
                  <p class="form-hint">
                    Calibrée : tire un délai parmi les derniers ordres réels. Nécessite
                    du trading réel actif.
                  </p>
                </div>
                <NullableNumberField
                  label="Latence fixe (ms)"
                  value={s().simExecLatencyMs ?? 150}
                  min={0}
                  step={10}
                  hint="Vide = 150 ms. Utilisé en mode fixe ou si données insuffisantes en mode calibré."
                  onChange={(value) =>
                    patch({
                      simExecLatencyMs: value != null && value >= 0 ? value : null,
                    })
                  }
                />
              </section>

              <section class="settings-section settings-section-full">
                <h3 class="settings-section-title">Auto-impact liquidité</h3>
                <ToggleField
                  label="Soustraire les fills sim récents du carnet"
                  checked={s().simSelfImpactEnabled === true}
                  hint="Deux ordres sim rapprochés consomment la même profondeur."
                  onChange={(checked) =>
                    patch({ simSelfImpactEnabled: checked ? true : null })
                  }
                />
                <NullableNumberField
                  label="TTL impact (secondes)"
                  value={s().simSelfImpactTtlSeconds ?? 8}
                  min={1}
                  step={1}
                  hint="Vide = 8 s"
                  onChange={(value) =>
                    patch({
                      simSelfImpactTtlSeconds: value != null && value >= 1 ? value : null,
                    })
                  }
                />
              </section>

              <section class="settings-section settings-section-full">
                <h3 class="settings-section-title">Préflight wallet</h3>
                <ToggleField
                  label="Vérifier la balance réelle avant un BUY sim"
                  checked={s().simWalletPreflightEnabled === true}
                  hint="Nécessite des credentials CLOB ; ignoré si indisponible."
                  onChange={(checked) =>
                    patch({ simWalletPreflightEnabled: checked ? true : null })
                  }
                />
              </section>

              <section class="settings-section settings-section-full">
                <h3 class="settings-section-title">Shadow logging</h3>
                <ToggleField
                  label="Comparer fills réels vs FAK local"
                  checked={s().simShadowLoggingEnabled === true}
                  hint="Enregistre les écarts pour calibrer la simulation."
                  onChange={(checked) =>
                    patch({ simShadowLoggingEnabled: checked ? true : null })
                  }
                />
                <NullableNumberField
                  label="Rétention échantillons (jours)"
                  value={s().shadowSampleRetentionDays ?? 14}
                  min={1}
                  step={1}
                  hint="Vide = 14 jours (latence + shadow)"
                  onChange={(value) =>
                    patch({
                      shadowSampleRetentionDays: value != null && value >= 1 ? value : null,
                    })
                  }
                />
              </section>

              <Show when={error()}>
                <p class="form-error">{error()}</p>
              </Show>
              <div class="dialog-actions">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  onClick={() => props.onClose()}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={saving()}
                  onClick={() => void save()}
                >
                  {saving() ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  );
}
