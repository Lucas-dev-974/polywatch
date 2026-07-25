import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { api } from '../api';
import {
  ENV_MODE_LABELS,
  pickModeFields,
  type EnvMode,
  type EnvSettings,
} from './env-settings-types';
import {
  EnvSettingsEntryTab,
  EnvSettingsExitTab,
  EnvSettingsRiskTab,
} from './EnvSettingsTabs';
import { Dialog } from './Dialog';

type SettingsTab = 'entry' | 'exit' | 'risk';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'entry', label: 'Entrée' },
  { id: 'exit', label: 'Sortie' },
  { id: 'risk', label: 'Risque' },
];

export interface EnvSettingsDialogProps {
  mode: EnvMode;
  open: boolean;
  onClose: () => void;
}

export function EnvSettingsDialogTrigger(props: { mode: EnvMode }) {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <button
        class="btn btn-secondary btn-sm"
        onClick={() => setOpen(true)}
      >
        Configurer
      </button>
      <EnvSettingsDialog
        mode={props.mode}
        open={open()}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function EnvSettingsDialog(props: EnvSettingsDialogProps) {
  const [activeTab, setActiveTab] = createSignal<SettingsTab>('entry');
  const [config, setConfig] = createSignal<EnvSettings | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function load() {
    try {
      setConfig(await api<EnvSettings>('/risk-config'));
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.toLowerCase().includes('too many requests')
          ? 'Trop de requêtes. Veuillez patienter quelques secondes avant de réessayer.'
          : 'Impossible de charger la configuration.';
      setError(msg);
    }
  }

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setActiveTab('entry');
        setError(null);
        void load();
      },
    ),
  );

  function patchConfig(patch: Partial<EnvSettings>) {
    const current = config();
    if (!current) return;
    setConfig({ ...current, ...patch });
  }

  async function save() {
    const current = config();
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const modeFields = pickModeFields(current, props.mode);
      const updated = await api<EnvSettings>('/risk-config', {
        method: 'PUT',
        body: JSON.stringify(modeFields),
      });
      setConfig(updated);
      props.onClose();
    } catch (err) {
      // Keep the dialog open: closing silently would discard the user's
      // changes while pretending they were saved.
      setError(
        err instanceof Error && err.message
          ? `Échec de l'enregistrement : ${err.message}`
          : "Échec de l'enregistrement.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Configuration copy trading"
      titleId={`env-settings-dialog-title-${props.mode}`}
      class="dialog-settings dialog-env-settings"
      bodyClass="dialog-body-settings"
      headerExtra={
        <span class={`badge ${props.mode === 'sim' ? 'sim' : 'real'}`}>
          {ENV_MODE_LABELS[props.mode]}
        </span>
      }
    >
      <Show
        when={config()}
        fallback={
          <div class="empty-state">
            {error() ?? 'Chargement…'}
            <Show when={error()}>
              <button
                class="btn btn-secondary btn-sm"
                style="margin-top: 0.5rem;"
                onClick={() => void load()}
              >
                Réessayer
              </button>
            </Show>
          </div>
        }
      >
        {(c) => (
          <>
            <nav class="settings-tabs" role="tablist" aria-label="Sections">
              <For each={SETTINGS_TABS}>
                {(tab) => (
                  <button
                    type="button"
                    class="settings-tab"
                    classList={{ active: activeTab() === tab.id }}
                    role="tab"
                    aria-selected={activeTab() === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </nav>

            <div class="settings-scroll">
              <Show when={activeTab() === 'entry'}>
                <EnvSettingsEntryTab
                  mode={props.mode}
                  config={c()}
                  onChange={patchConfig}
                />
              </Show>

              <Show when={activeTab() === 'exit'}>
                <EnvSettingsExitTab
                  mode={props.mode}
                  config={c()}
                  onChange={patchConfig}
                />
              </Show>

              <Show when={activeTab() === 'risk'}>
                <EnvSettingsRiskTab
                  mode={props.mode}
                  config={c()}
                  onChange={patchConfig}
                />
              </Show>
            </div>

            <div class="settings-footer settings-footer-actions">
              <Show when={error()}>
                <p class="form-error">{error()}</p>
              </Show>
              <div class="settings-footer-buttons">
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={saving()}
                  onClick={() => props.onClose()}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={saving()}
                  onClick={() => void save()}
                >
                  {saving() ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </>
        )}
      </Show>
    </Dialog>
  );
}
