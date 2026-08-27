import { createEffect, createSignal, For, on, Show } from 'solid-js';
import {
  fetchCryptoConfig,
  fetchGlobalConfig,
  updateCryptoConfig,
  updateGlobalConfig,
} from '../api';
import { loadAutoTrackRules } from '../stores/autoTrackStore';
import { CryptoAlgoSettingsAutotrackTab } from './CryptoAlgoSettingsAutotrackTab';
import { CryptoAlgoSettingsEntryTab } from './CryptoAlgoSettingsEntryTab';
import { CryptoAlgoSettingsExitTab } from './CryptoAlgoSettingsExitTab';
import { CryptoAlgoSettingsGeneralTab } from './CryptoAlgoSettingsGeneralTab';
import {
  pickCryptoAlgoFields,
  type CryptoAlgoSettings,
} from './settings/crypto-algo-settings-types';
import { type EnvSettings } from './settings/env-settings-types';
import { Dialog } from './Dialog';

type SettingsTab = 'general' | 'entry' | 'exit' | 'autotrack';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'entry', label: 'Entrée' },
  { id: 'exit', label: 'Sortie' },
  { id: 'autotrack', label: 'Suivi auto' },
];

export interface CryptoAlgoSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onAutoTrackChange?: () => void;
}

export interface CryptoAlgoSettingsDialogTriggerProps {
  onAutoTrackChange?: () => void;
}

export function CryptoAlgoSettingsDialogTrigger(
  props: CryptoAlgoSettingsDialogTriggerProps = {},
) {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <button class="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Configurer
      </button>
      <CryptoAlgoSettingsDialog
        open={open()}
        onClose={() => setOpen(false)}
        onAutoTrackChange={props.onAutoTrackChange}
      />
    </>
  );
}

export function CryptoAlgoSettingsDialog(props: CryptoAlgoSettingsDialogProps) {
  const [config, setConfig] = createSignal<CryptoAlgoSettings | null>(null);
  const [activeTab, setActiveTab] = createSignal<SettingsTab>('general');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** Tracks JsonIntervalMapField draft validity (C7.5). */
  const jsonValidity = new Map<string, boolean>();
  const [jsonInvalidCount, setJsonInvalidCount] = createSignal(0);

  function onJsonValidityChange(fieldId: string, valid: boolean) {
    const prev = jsonValidity.get(fieldId) ?? true;
    if (prev === valid) return;
    jsonValidity.set(fieldId, valid);
    let invalid = 0;
    for (const ok of jsonValidity.values()) {
      if (!ok) invalid++;
    }
    setJsonInvalidCount(invalid);
  }

  async function load() {
    try {
      const [crypto, global] = await Promise.all([
        fetchCryptoConfig(),
        fetchGlobalConfig(),
      ]);
      setConfig(
        pickCryptoAlgoFields({
          ...(crypto as unknown as EnvSettings),
          maxSlippagePercent: global.maxSlippagePercent,
        }),
      );
      setError(null);
      jsonValidity.clear();
      setJsonInvalidCount(0);
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
        setError(null);
        setActiveTab('general');
        void load();
        void loadAutoTrackRules();
      },
    ),
  );

  function patchConfig(patch: Partial<CryptoAlgoSettings>) {
    const current = config();
    if (!current) return;
    setConfig({ ...current, ...patch });
  }

  async function save() {
    const current = config();
    if (!current) return;

    if (jsonInvalidCount() > 0) {
      setError(
        'JSON d\'intervalle invalide — corrigez le champ en erreur ou réinitialisez aux defaults.',
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { maxSlippagePercent, ...cryptoPatch } = current;
      const [updated] = await Promise.all([
        updateCryptoConfig(cryptoPatch as unknown as Record<string, unknown>),
        updateGlobalConfig({ maxSlippagePercent }),
      ]);
      setConfig(
        pickCryptoAlgoFields({
          ...(updated as unknown as EnvSettings),
          maxSlippagePercent,
        }),
      );
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

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Configuration Crypto Algo"
      titleId="crypto-algo-settings-dialog-title"
      class="dialog-settings"
      bodyClass="dialog-body-settings"
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
            <nav class="settings-tabs" role="tablist" aria-label="Sections crypto algo">
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
              <Show when={activeTab() === 'general'}>
                <CryptoAlgoSettingsGeneralTab
                  config={c()}
                  onChange={patchConfig}
                  onJsonValidityChange={onJsonValidityChange}
                />
              </Show>
              <Show when={activeTab() === 'entry'}>
                <CryptoAlgoSettingsEntryTab
                  config={c()}
                  onChange={patchConfig}
                  onJsonValidityChange={onJsonValidityChange}
                />
              </Show>
              <Show when={activeTab() === 'exit'}>
                <CryptoAlgoSettingsExitTab
                  config={c()}
                  onChange={patchConfig}
                  onJsonValidityChange={onJsonValidityChange}
                />
              </Show>
              <Show when={activeTab() === 'autotrack'}>
                <CryptoAlgoSettingsAutotrackTab
                  onAutoTrackChange={props.onAutoTrackChange}
                />
              </Show>
            </div>

            <div class="settings-footer">
              <Show when={error()}>
                <p class="form-error">{error()}</p>
              </Show>
              <button
                class="btn btn-primary btn-block"
                disabled={saving() || jsonInvalidCount() > 0}
                onClick={() => void save()}
              >
                {saving() ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </Show>
    </Dialog>
  );
}
