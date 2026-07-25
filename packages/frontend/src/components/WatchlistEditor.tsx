import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import {
  computeMoveDetectorRequestsPerMinute,
  countActiveWatchlistTraders,
  DEFAULT_MOVE_DETECTOR_INTERVAL_MS,
  MAX_MOVE_DETECTOR_INTERVAL_MS,
  MIN_MOVE_DETECTOR_INTERVAL_MS,
} from '@polywatch/core/worker/move-detector-settings';
import { api } from '../api';
import { Dialog } from './Dialog';
import { useWatchlistStore, type WatchlistEntry } from '../stores/watchlistStore';

type ToggleField = 'active' | 'simEnabled' | 'realEnabled';
type WatchlistTab = 'traders' | 'params';

const WATCHLIST_TABS: { id: WatchlistTab; label: string }[] = [
  { id: 'traders', label: 'Traders' },
  { id: 'params', label: 'Paramètres' },
];

interface DetectorSettings {
  moveDetectorIntervalMs: number;
}

function formatRequestsPerMinute(value: number): string {
  if (value <= 0) return '0';
  if (value >= 100) return Math.round(value).toLocaleString('fr-FR');
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function WatchlistItem(props: {
  entry: WatchlistEntry;
  onToggle: (id: number, field: ToggleField, value: boolean) => void;
  onRemove: (id: number) => void;
  busy: boolean;
}) {
  return (
    <div class="watchlist-item">
      <div class="watchlist-item-header">
        <div>
          <div class="trader-name">
            {props.entry.nickname ?? props.entry.traderAddress.slice(0, 10) + '…'}
          </div>
          <div class="trader-address">{props.entry.traderAddress}</div>
        </div>
        <button
          class="btn btn-danger btn-sm btn-icon"
          title="Supprimer"
          disabled={props.busy}
          onClick={() => props.onRemove(props.entry.id)}
        >
          ✕
        </button>
      </div>
      <div class="watchlist-item-controls">
        <div class="chip-group">
          <label class={`chip chip-active ${props.entry.active ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={props.entry.active}
              disabled={props.busy}
              onChange={(e) =>
                props.onToggle(props.entry.id, 'active', e.currentTarget.checked)
              }
            />
            Actif
          </label>
          <label class={`chip chip-sim ${props.entry.simEnabled ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={props.entry.simEnabled}
              disabled={props.busy}
              onChange={(e) =>
                props.onToggle(props.entry.id, 'simEnabled', e.currentTarget.checked)
              }
            />
            Sim
          </label>
          <label class={`chip chip-real ${props.entry.realEnabled ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={props.entry.realEnabled}
              disabled={props.busy}
              onChange={(e) =>
                props.onToggle(props.entry.id, 'realEnabled', e.currentTarget.checked)
              }
            />
            Réel
          </label>
        </div>
      </div>
    </div>
  );
}

function WatchlistParamsTab(props: {
  activeTraderCount: () => number;
  intervalSeconds: () => number;
  onIntervalSecondsChange: (seconds: number) => void;
  requestsPerMinute: () => number;
  saving: () => boolean;
  error: () => string | null;
  onSave: () => void;
}) {
  const minSeconds = MIN_MOVE_DETECTOR_INTERVAL_MS / 1000;
  const maxSeconds = MAX_MOVE_DETECTOR_INTERVAL_MS / 1000;

  return (
    <div class="form-stack watchlist-params">
      <p class="form-hint">
        Intervalle entre deux cycles de détection des mouvements. Chaque trader
        actif (Actif, Sim ou Réel) déclenche une requête API positions par cycle.
      </p>

      <label class="form-field">
        <span class="form-label">Intervalle de détection (secondes)</span>
        <input
          class="input"
          type="number"
          min={minSeconds}
          max={maxSeconds}
          step={0.5}
          value={props.intervalSeconds()}
          onInput={(e) => {
            const parsed = Number(e.currentTarget.value);
            if (Number.isFinite(parsed)) {
              props.onIntervalSecondsChange(parsed);
            }
          }}
        />
        <span class="form-hint">
          Entre {minSeconds} et {maxSeconds} s (défaut{' '}
          {DEFAULT_MOVE_DETECTOR_INTERVAL_MS / 1000} s).
        </span>
      </label>

      <div class="watchlist-params-metrics">
        <div class="watchlist-params-metric">
          <span class="watchlist-params-metric-label">Traders surveillés</span>
          <span class="watchlist-params-metric-value">{props.activeTraderCount()}</span>
        </div>
        <div class="watchlist-params-metric">
          <span class="watchlist-params-metric-label">Requêtes API / minute</span>
          <span class="watchlist-params-metric-value">
            {formatRequestsPerMinute(props.requestsPerMinute())}
          </span>
        </div>
      </div>

      <Show when={props.error()}>
        <p class="form-error">{props.error()}</p>
      </Show>

      <div class="dialog-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          disabled={props.saving()}
          onClick={() => props.onSave()}
        >
          {props.saving() ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

export function WatchlistEditor() {
  const store = useWatchlistStore();
  const [newAddress, setNewAddress] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<WatchlistTab>('traders');
  const [toggling, setToggling] = createSignal<Set<number>>(new Set());
  const [removing, setRemoving] = createSignal<Set<number>>(new Set());
  const [intervalSeconds, setIntervalSeconds] = createSignal(
    DEFAULT_MOVE_DETECTOR_INTERVAL_MS / 1000,
  );
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);
  const [settingsSaving, setSettingsSaving] = createSignal(false);
  const [settingsError, setSettingsError] = createSignal<string | null>(null);

  const activeTraderCount = createMemo(() =>
    countActiveWatchlistTraders(store.entries()),
  );

  const requestsPerMinute = createMemo(() =>
    computeMoveDetectorRequestsPerMinute(
      activeTraderCount(),
      intervalSeconds() * 1000,
    ),
  );

  onMount(() => void store.load());

  async function loadDetectorSettings() {
    try {
      const settings = await api<DetectorSettings>('/watchlist/settings');
      setIntervalSeconds(settings.moveDetectorIntervalMs / 1000);
      setSettingsError(null);
      setSettingsLoaded(true);
    } catch {
      setSettingsError('Impossible de charger les paramètres de détection.');
      setSettingsLoaded(false);
    }
  }

  function openDialog() {
    setOpen(true);
    setActiveTab('traders');
    void store.load();
    void loadDetectorSettings();
  }

  async function saveDetectorSettings() {
    const seconds = intervalSeconds();
    const intervalMs = Math.round(seconds * 1000);
    if (
      intervalMs < MIN_MOVE_DETECTOR_INTERVAL_MS ||
      intervalMs > MAX_MOVE_DETECTOR_INTERVAL_MS
    ) {
      setSettingsError(
        `L'intervalle doit être entre ${MIN_MOVE_DETECTOR_INTERVAL_MS / 1000} et ${MAX_MOVE_DETECTOR_INTERVAL_MS / 1000} secondes.`,
      );
      return;
    }

    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const updated = await api<DetectorSettings>('/watchlist/settings', {
        method: 'PUT',
        body: JSON.stringify({ moveDetectorIntervalMs: intervalMs }),
      });
      setIntervalSeconds(updated.moveDetectorIntervalMs / 1000);
    } catch (err) {
      setSettingsError(
        err instanceof Error && err.message
          ? `Échec de l'enregistrement : ${err.message}`
          : "Échec de l'enregistrement.",
      );
    } finally {
      setSettingsSaving(false);
    }
  }

  async function addTrader() {
    if (!newAddress()) return;
    const address = newAddress();
    setNewAddress('');
    try {
      await store.add(address);
    } catch {
      setNewAddress(address);
    }
  }

  async function toggle(id: number, field: ToggleField, value: boolean) {
    const set = new Set(toggling());
    set.add(id);
    setToggling(set);
    try {
      await store.patch(id, { [field]: value });
    } catch {
      // Le store recharge automatiquement après succès ;
      // en cas d'échec l'état précédent reste affiché.
    } finally {
      const s2 = new Set(toggling());
      s2.delete(id);
      setToggling(s2);
    }
  }

  async function remove(id: number) {
    const set = new Set(removing());
    set.add(id);
    setRemoving(set);
    try {
      await store.remove(id);
    } catch {
      // Le store recharge automatiquement après succès.
    } finally {
      const s2 = new Set(removing());
      s2.delete(id);
      setRemoving(s2);
    }
  }

  return (
    <>
      <button class="btn btn-secondary btn-sm" onClick={openDialog}>
        Watchlist
        <span class="panel-count">{store.entries().length}</span>
      </button>

      <Dialog
        open={open()}
        onClose={() => setOpen(false)}
        title="Watchlist"
        titleId="watchlist-dialog-title"
        class="dialog-settings"
        bodyClass="dialog-body-settings"
        headerExtra={<span class="panel-count">{store.entries().length}</span>}
      >
        <nav class="settings-tabs" role="tablist" aria-label="Sections watchlist">
          <For each={WATCHLIST_TABS}>
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

        <Show when={activeTab() === 'traders'}>
          <div class="settings-scroll">
            <div class="input-group">
              <input
                class="input input-mono"
                placeholder="Adresse trader 0x..."
                value={newAddress()}
                onInput={(e) => setNewAddress(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addTrader();
                }}
              />
              <button class="btn btn-primary" onClick={() => void addTrader()}>
                Ajouter
              </button>
            </div>

            <Show
              when={store.entries().length > 0}
              fallback={
                <div class="empty-state">
                  <div class="empty-state-icon">◎</div>
                  Aucun trader surveillé
                </div>
              }
            >
              <div class="watchlist-list">
                <For each={store.entries()}>
                  {(entry) => (
                    <WatchlistItem
                      entry={entry}
                      onToggle={toggle}
                      onRemove={remove}
                      busy={toggling().has(entry.id) || removing().has(entry.id)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={activeTab() === 'params'}>
          <div class="settings-scroll">
            <Show
              when={settingsLoaded()}
              fallback={
                <div class="empty-state">
                  {settingsError() ?? 'Chargement…'}
                  <Show when={settingsError()}>
                    <button
                      class="btn btn-secondary btn-sm"
                      style="margin-top: 0.5rem;"
                      onClick={() => void loadDetectorSettings()}
                    >
                      Réessayer
                    </button>
                  </Show>
                </div>
              }
            >
              <WatchlistParamsTab
                activeTraderCount={activeTraderCount}
                intervalSeconds={intervalSeconds}
                onIntervalSecondsChange={setIntervalSeconds}
                requestsPerMinute={requestsPerMinute}
                saving={settingsSaving}
                error={settingsError}
                onSave={() => void saveDetectorSettings()}
              />
            </Show>
          </div>
        </Show>
      </Dialog>
    </>
  );
}
