import { createEffect, createSignal, For, Show } from 'solid-js';
import {
  fetchSimInitialCapital,
  formatSimCapital,
  resetSimulation,
  type SimAlgoKind,
  type SimResetResult,
} from '../lib/simulation';
import { api } from '../api';
import { Dialog } from './Dialog';
import { type EnvSettings, pickModeFields } from './env-settings-types';
import {
  type CryptoAlgoSettings,
  pickCryptoAlgoFields,
} from './crypto-algo-settings-types';
import { EnvSettingsEntryTab, EnvSettingsExitTab, EnvSettingsRiskTab } from './EnvSettingsTabs';
import { CryptoAlgoSettingsGeneralTab } from './CryptoAlgoSettingsGeneralTab';
import { CryptoAlgoSettingsExitTab } from './CryptoAlgoSettingsExitTab';
import { CryptoAlgoSettingsAutotrackTab } from './CryptoAlgoSettingsAutotrackTab';

export interface NewSessionResetDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'post-apply' | 'manual';
  defaultLabel?: string;
  onDone?: (result: SimResetResult | null) => void;
  algoKind?: SimAlgoKind;
}

type CopyConfigTab = 'entry' | 'exit' | 'risk';
type AlgoConfigTab = 'general' | 'exit' | 'autotrack';

const COPY_CONFIG_TABS: { id: CopyConfigTab; label: string }[] = [
  { id: 'entry', label: 'Entrée' },
  { id: 'exit', label: 'Sortie' },
  { id: 'risk', label: 'Risque' },
];

const ALGO_CONFIG_TABS: { id: AlgoConfigTab; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'exit', label: 'Sortie' },
  { id: 'autotrack', label: 'Suivi auto' },
];

export function NewSessionResetDialog(props: NewSessionResetDialogProps) {
  const [label, setLabel] = createSignal('');
  const [capital, setCapital] = createSignal<number | null>(null);
  const [archive, setArchive] = createSignal(true);
  const [deepClean, setDeepClean] = createSignal(props.mode === 'post-apply');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  // Copy Config state
  const [copyConfigOpen, setCopyConfigOpen] = createSignal(false);
  const [copyConfig, setCopyConfig] = createSignal<EnvSettings | null>(null);
  const [copyConfigTab, setCopyConfigTab] = createSignal<CopyConfigTab>('entry');
  const [copyConfigLoading, setCopyConfigLoading] = createSignal(false);

  // Algo Config state
  const [algoConfigOpen, setAlgoConfigOpen] = createSignal(false);
  const [algoConfig, setAlgoConfig] = createSignal<CryptoAlgoSettings | null>(null);
  const [algoConfigTab, setAlgoConfigTab] = createSignal<AlgoConfigTab>('general');
  const [algoConfigLoading, setAlgoConfigLoading] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setError(null);
    setSuccess(null);
    setLabel(props.defaultLabel ?? '');
    setDeepClean(props.mode === 'post-apply');
    setArchive(true);
    setCopyConfigOpen(false);
    setAlgoConfigOpen(false);
    setCopyConfig(null);
    setAlgoConfig(null);
    void fetchSimInitialCapital(props.algoKind ?? 'crypto')
      .then(setCapital)
      .catch(() => setCapital(null));
  });

  async function loadCopyConfig() {
    setCopyConfigLoading(true);
    try {
      const full = await api<EnvSettings>('/risk-config');
      setCopyConfig(full);
    } catch {
      setError('Impossible de charger la configuration copy trading.');
    } finally {
      setCopyConfigLoading(false);
    }
  }

  async function loadAlgoConfig() {
    setAlgoConfigLoading(true);
    try {
      const full = await api<EnvSettings>('/risk-config');
      setAlgoConfig(pickCryptoAlgoFields(full));
    } catch {
      setError('Impossible de charger la configuration crypto algo.');
    } finally {
      setAlgoConfigLoading(false);
    }
  }

  function toggleCopyConfig() {
    const next = !copyConfigOpen();
    setCopyConfigOpen(next);
    if (next && !copyConfig()) {
      void loadCopyConfig();
    }
  }

  function toggleAlgoConfig() {
    const next = !algoConfigOpen();
    setAlgoConfigOpen(next);
    if (next && !algoConfig()) {
      void loadAlgoConfig();
    }
  }

  function patchCopyConfig(patch: Partial<EnvSettings>) {
    const current = copyConfig();
    if (!current) return;
    setCopyConfig({ ...current, ...patch });
  }

  function patchAlgoConfig(patch: Partial<CryptoAlgoSettings>) {
    const current = algoConfig();
    if (!current) return;
    setAlgoConfig({ ...current, ...patch });
  }

  async function saveConfigs() {
    const cc = copyConfig();
    if (cc) {
      const modeFields = pickModeFields(cc, 'sim');
      await api<EnvSettings>('/risk-config', {
        method: 'PUT',
        body: JSON.stringify(modeFields),
      });
    }
    const ac = algoConfig();
    if (ac) {
      await api<EnvSettings>('/risk-config', {
        method: 'PUT',
        body: JSON.stringify(ac),
      });
    }
  }

  async function confirmReset() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const amount = capital();
      if (amount == null || amount < 0) {
        throw new Error('Capital initial indisponible');
      }
      // Save configs before reset
      await saveConfigs();
      const result = await resetSimulation({
        algoKind: props.algoKind ?? 'crypto',
        amount,
        archive: archive(),
        deepClean: deepClean(),
        newSessionLabel: label().trim() || null,
      });
      setSuccess('Nouvelle session démarrée avec succès.');
      props.onDone?.(result);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la réinitialisation');
      props.onDone?.(null);
    } finally {
      setLoading(false);
    }
  }

  const title = () =>
    props.mode === 'post-apply'
      ? 'Nouvelle session après recommandations'
      : 'Réinitialiser la simulation';

  const intro = () =>
    props.mode === 'post-apply'
      ? 'Les paramètres recommandés ont été appliqués. Souhaitez-vous archiver la session courante et repartir sur une base saine ?'
      : 'Archiver la session courante et réinitialiser la simulation. Un snapshot « Avant réinitialisation » est créé automatiquement si la session a de l\'activité.';

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={title()}
      titleId="new-session-reset-dialog-title"
      class="dialog-creds new-session-reset-dialog"
      bodyClass="new-session-reset-body"
    >
      <div class="new-session-reset-layout">
        {/* Left / main column: reset parameters */}
        <div class="new-session-reset-main">
          <div class="new-session-reset-summary">
            <p class="new-session-reset-intro">{intro()}</p>
            <ul class="new-session-reset-impacts">
              <li>
                <span class="impact-marker archive" aria-hidden="true" />
                <span>
                  <strong>Archivage :</strong> positions, exécutions, tentatives de sortie,
                  surveillance, bougies 1 min
                </span>
              </li>
              <Show when={deepClean()}>
                <li>
                  <span class="impact-marker purge" aria-hidden="true" />
                  <span>
                    <strong>Purge :</strong> ticks marché, surveillance terminée, historique
                    prix (copy trading sim inclus)
                  </span>
                </li>
              </Show>
            </ul>
          </div>

          <div class="new-session-reset-fields">
            <label class="form-field">
              <span class="form-label">Label de la nouvelle session</span>
              <input
                class="input"
                type="text"
                maxlength={200}
                placeholder="Ex. Post-rapport 2026-07-11"
                value={label()}
                onInput={(e) => setLabel(e.currentTarget.value)}
              />
            </label>

            <label class="form-field">
              <span class="form-label">Capital initial (pUSD)</span>
              <input
                class="input"
                type="number"
                min={0}
                step={1}
                value={capital() ?? ''}
                onInput={(e) => setCapital(Number(e.currentTarget.value))}
              />
              <Show when={capital() != null}>
                <span class="form-hint">{formatSimCapital(capital()!)} pUSD</span>
              </Show>
            </label>

            <div class="new-session-reset-options">
              <label class="form-field checkbox-field">
                <input
                  type="checkbox"
                  checked={archive()}
                  onChange={(e) => setArchive(e.currentTarget.checked)}
                />
                <span>Archiver la session courante avant reset</span>
              </label>

              <label class="form-field checkbox-field">
                <input
                  type="checkbox"
                  checked={deepClean()}
                  onChange={(e) => setDeepClean(e.currentTarget.checked)}
                />
                <span>
                  Purger les données marché (base saine — recommandé après application de
                  paramètres)
                </span>
              </label>
            </div>
          </div>

          <div class="new-session-reset-alerts">
            <Show when={error()}>
              <p class="form-error">{error()}</p>
            </Show>
            <Show when={success()}>
              <p class="form-hint">{success()}</p>
            </Show>
          </div>

          <div class="dialog-actions new-session-reset-actions">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={loading()}
              onClick={() => {
                props.onDone?.(null);
                props.onClose();
              }}
            >
              {props.mode === 'post-apply' ? 'Non, garder la session' : 'Annuler'}
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={loading() || capital() == null}
              onClick={() => void confirmReset()}
            >
              {loading() ? 'Réinitialisation…' : 'Confirmer la nouvelle session'}
            </button>
          </div>
        </div>

        {/* Right / side column: optional config accordion */}
        <div class="new-session-reset-side">
          <div class="new-session-reset-side-header">
            <h3>Configuration optionnelle</h3>
            <p class="form-hint">
              Ajustez les paramètres Copy et Algo avant de démarrer la nouvelle session.
            </p>
          </div>

          {/* Copy Config section */}
          <div class="reset-config-section">
            <button
              type="button"
              class="reset-config-header"
              onClick={() => toggleCopyConfig()}
              aria-expanded={copyConfigOpen()}
            >
              <span class="reset-config-title">Copy Config</span>
              <span class="reset-config-chevron" classList={{ open: copyConfigOpen() }}>
                ▾
              </span>
            </button>
            <Show when={copyConfigOpen()}>
              <div class="reset-config-body">
                <Show
                  when={copyConfig()}
                  fallback={
                    <div class="empty-state">
                      {copyConfigLoading()
                        ? 'Chargement…'
                        : 'Impossible de charger la configuration.'}
                    </div>
                  }
                >
                  {(c) => (
                    <>
                      <nav class="settings-tabs" role="tablist" aria-label="Sections copy config">
                        <For each={COPY_CONFIG_TABS}>
                          {(tab) => (
                            <button
                              type="button"
                              class="settings-tab"
                              classList={{ active: copyConfigTab() === tab.id }}
                              role="tab"
                              aria-selected={copyConfigTab() === tab.id}
                              onClick={() => setCopyConfigTab(tab.id)}
                            >
                              {tab.label}
                            </button>
                          )}
                        </For>
                      </nav>
                      <div class="settings-scroll">
                        <Show when={copyConfigTab() === 'entry'}>
                          <EnvSettingsEntryTab
                            mode="sim"
                            config={c()}
                            onChange={patchCopyConfig}
                          />
                        </Show>
                        <Show when={copyConfigTab() === 'exit'}>
                          <EnvSettingsExitTab
                            mode="sim"
                            config={c()}
                            onChange={patchCopyConfig}
                          />
                        </Show>
                        <Show when={copyConfigTab() === 'risk'}>
                          <EnvSettingsRiskTab
                            mode="sim"
                            config={c()}
                            onChange={patchCopyConfig}
                          />
                        </Show>
                      </div>
                    </>
                  )}
                </Show>
              </div>
            </Show>
          </div>

          {/* Algo Config section */}
          <div class="reset-config-section">
            <button
              type="button"
              class="reset-config-header"
              onClick={() => toggleAlgoConfig()}
              aria-expanded={algoConfigOpen()}
            >
              <span class="reset-config-title">Algo Config</span>
              <span class="reset-config-chevron" classList={{ open: algoConfigOpen() }}>
                ▾
              </span>
            </button>
            <Show when={algoConfigOpen()}>
              <div class="reset-config-body">
                <Show
                  when={algoConfig()}
                  fallback={
                    <div class="empty-state">
                      {algoConfigLoading()
                        ? 'Chargement…'
                        : 'Impossible de charger la configuration.'}
                    </div>
                  }
                >
                  {(c) => (
                    <>
                      <nav class="settings-tabs" role="tablist" aria-label="Sections algo config">
                        <For each={ALGO_CONFIG_TABS}>
                          {(tab) => (
                            <button
                              type="button"
                              class="settings-tab"
                              classList={{ active: algoConfigTab() === tab.id }}
                              role="tab"
                              aria-selected={algoConfigTab() === tab.id}
                              onClick={() => setAlgoConfigTab(tab.id)}
                            >
                              {tab.label}
                            </button>
                          )}
                        </For>
                      </nav>
                      <div class="settings-scroll">
                        <Show when={algoConfigTab() === 'general'}>
                          <CryptoAlgoSettingsGeneralTab
                            config={c()}
                            onChange={patchAlgoConfig}
                          />
                        </Show>
                        <Show when={algoConfigTab() === 'exit'}>
                          <CryptoAlgoSettingsExitTab
                            config={c()}
                            onChange={patchAlgoConfig}
                          />
                        </Show>
                        <Show when={algoConfigTab() === 'autotrack'}>
                          <CryptoAlgoSettingsAutotrackTab />
                        </Show>
                      </div>
                    </>
                  )}
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
