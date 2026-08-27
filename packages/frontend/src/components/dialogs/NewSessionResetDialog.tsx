import { createEffect, createSignal, For, Show } from 'solid-js';
import {
  fetchSimInitialCapital,
  formatSimCapital,
  resetSimulation,
  type SimAlgoKind,
  type SimResetResult,
} from '../../lib/simulation';
import {
  fetchCopyConfig,
  fetchCryptoConfig,
  fetchGlobalConfig,
  updateCopyConfig,
  updateCryptoConfig,
  updateGlobalConfig,
  type CopyConfig,
} from '../../api';
import { Dialog } from '../Dialog';
import { type EnvSettings } from '../settings/env-settings-types';
import {
  type CryptoAlgoSettings,
  pickCryptoAlgoFields,
} from '../settings/crypto-algo-settings-types';
import { EnvSettingsEntryTab, EnvSettingsExitTab, EnvSettingsRiskTab } from '../algo/EnvSettingsTabs';
import { CryptoAlgoSettingsGeneralTab } from '../algo/CryptoAlgoSettingsGeneralTab';
import { CryptoAlgoSettingsExitTab } from '../algo/CryptoAlgoSettingsExitTab';
import { CryptoAlgoSettingsAutotrackTab } from '../algo/CryptoAlgoSettingsAutotrackTab';
import { WeatherAlgoSettingsTab } from '../algo/WeatherAlgoSettingsTab';

export interface NewSessionResetDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'post-apply' | 'manual';
  defaultLabel?: string;
  onDone?: (result: SimResetResult | null) => void;
  algoKind?: SimAlgoKind;
}

const ALGO_LABEL: Record<SimAlgoKind, string> = {
  crypto: 'Crypto',
  weather: 'Weather',
  copy: 'Copy',
};

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

  const kind = () => props.algoKind ?? 'crypto';

  // Copy Config state (loaded via /config/copy — never the legacy /risk-config blob)
  const [copyConfigOpen, setCopyConfigOpen] = createSignal(false);
  const [copyConfig, setCopyConfig] = createSignal<(CopyConfig & EnvSettings) | null>(null);
  const [copyConfigTab, setCopyConfigTab] = createSignal<CopyConfigTab>('entry');
  const [copyConfigLoading, setCopyConfigLoading] = createSignal(false);

  // Algo Config state
  const [algoConfigOpen, setAlgoConfigOpen] = createSignal(false);
  const [algoConfig, setAlgoConfig] = createSignal<CryptoAlgoSettings | null>(null);
  const [algoConfigTab, setAlgoConfigTab] = createSignal<AlgoConfigTab>('general');
  const [algoConfigLoading, setAlgoConfigLoading] = createSignal(false);

  // Weather Config state
  const [weatherConfigOpen, setWeatherConfigOpen] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setError(null);
    setSuccess(null);
    setLabel(props.defaultLabel ?? '');
    setDeepClean(props.mode === 'post-apply');
    setArchive(true);
    setCopyConfigOpen(false);
    setAlgoConfigOpen(false);
    setWeatherConfigOpen(false);
    setCopyConfig(null);
    setAlgoConfig(null);
    void fetchSimInitialCapital(kind())
      .then(setCapital)
      .catch(() => setCapital(null));
  });

  async function loadCopyConfig() {
    setCopyConfigLoading(true);
    try {
      const cfg = await fetchCopyConfig();
      // Tabs expect EnvSettings shape but only patch copy fields.
      setCopyConfig(cfg as CopyConfig & EnvSettings);
    } catch {
      setError('Impossible de charger la configuration copy trading.');
    } finally {
      setCopyConfigLoading(false);
    }
  }

  async function loadAlgoConfig() {
    setAlgoConfigLoading(true);
    try {
      const [crypto, global] = await Promise.all([
        fetchCryptoConfig(),
        fetchGlobalConfig(),
      ]);
      setAlgoConfig(
        pickCryptoAlgoFields({
          ...(crypto as unknown as EnvSettings),
          maxSlippagePercent: global.maxSlippagePercent,
        }),
      );
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

  function toggleWeatherConfig() {
    setWeatherConfigOpen(!weatherConfigOpen());
  }

  function patchCopyConfig(patch: Partial<EnvSettings>) {
    const current = copyConfig();
    if (!current) return;
    setCopyConfig({ ...current, ...patch } as CopyConfig & EnvSettings);
  }

  function patchAlgoConfig(patch: Partial<CryptoAlgoSettings>) {
    const current = algoConfig();
    if (!current) return;
    setAlgoConfig({ ...current, ...patch });
  }

  async function saveConfigs() {
    const cc = copyConfig();
    if (kind() === 'copy' && cc) {
      await updateCopyConfig(cc);
    }
    const ac = algoConfig();
    if (kind() === 'crypto' && ac) {
      const { maxSlippagePercent, ...cryptoPatch } = ac;
      await Promise.all([
        updateCryptoConfig(cryptoPatch as unknown as Record<string, unknown>),
        updateGlobalConfig({ maxSlippagePercent }),
      ]);
    }
    // Weather: WeatherAlgoSettingsTab persists via its own Save button.
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
      await saveConfigs();
      const result = await resetSimulation({
        algoKind: kind(),
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
      ? `Nouvelle session ${ALGO_LABEL[kind()]} après recommandations`
      : `Réinitialiser la simulation ${ALGO_LABEL[kind()]}`;

  const intro = () =>
    props.mode === 'post-apply'
      ? `Les paramètres recommandés ont été appliqués. Souhaitez-vous archiver la session ${ALGO_LABEL[kind()]} courante et repartir sur une base saine ?`
      : `Archiver la session ${ALGO_LABEL[kind()]} courante et réinitialiser uniquement cette simulation. Un snapshot « Avant réinitialisation » est créé automatiquement si la session a de l'activité. Les autres algos (balances, sessions, positions) ne sont pas touchés.`;

  const deepCleanImpacts = () =>
    kind() === 'crypto'
      ? 'ticks de position, tentatives de sortie et surveillance terminée liés à cette session'
      : 'ticks de position et tentatives de sortie liés à cette session';

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
                  <strong>Archivage (session {ALGO_LABEL[kind()]}) :</strong> positions, exécutions, tentatives de sortie,
                  surveillance, bougies 1 min
                </span>
              </li>
              <Show when={deepClean()}>
                <li>
                  <span class="impact-marker purge" aria-hidden="true" />
                  <span>
                    <strong>Purge :</strong> {deepCleanImpacts()}
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
              {loading()
                ? 'Réinitialisation…'
                : `Confirmer la réinit ${ALGO_LABEL[kind()]}`}
            </button>
          </div>
        </div>

        {/* Right / side column: optional config accordion (kind-aware) */}
        <div class="new-session-reset-side">
          <div class="new-session-reset-side-header">
            <h3>Configuration optionnelle</h3>
            <p class="form-hint">
              Ajustez les paramètres {ALGO_LABEL[kind()]} avant de démarrer la nouvelle session.
            </p>
          </div>

          {/* Copy Config section — copy only */}
          <Show when={kind() === 'copy'}>
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
          </Show>

          {/* Algo Config section — crypto only */}
          <Show when={kind() === 'crypto'}>
            <div class="reset-config-section">
              <button
                type="button"
                class="reset-config-header"
                onClick={() => toggleAlgoConfig()}
                aria-expanded={algoConfigOpen()}
              >
                <span class="reset-config-title">Crypto Algo Config</span>
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
          </Show>

          {/* Weather Config section — weather only */}
          <Show when={kind() === 'weather'}>
            <div class="reset-config-section">
              <button
                type="button"
                class="reset-config-header"
                onClick={() => toggleWeatherConfig()}
                aria-expanded={weatherConfigOpen()}
              >
                <span class="reset-config-title">Weather Config</span>
                <span class="reset-config-chevron" classList={{ open: weatherConfigOpen() }}>
                  ▾
                </span>
              </button>
              <Show when={weatherConfigOpen()}>
                <div class="reset-config-body">
                  <div class="settings-scroll">
                    <WeatherAlgoSettingsTab />
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
