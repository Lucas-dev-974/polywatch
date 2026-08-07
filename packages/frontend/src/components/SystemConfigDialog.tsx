import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { api } from '../api';
import { Dialog } from './Dialog';
import {
  formatSystemConfigValue,
  getSystemConfigMeta,
  groupSystemConfigEntries,
  SYSTEM_CONFIG_CATEGORY_META,
} from './system-config-metadata';

interface SystemConfigEntry {
  key: string;
  value: string;
  category: string | null;
  description: string | null;
  updatedAt: string;
}

const CATEGORIES = [
  { id: 'worker', label: 'Worker' },
  { id: 'surveillance', label: 'Surveillance' },
  { id: 'auto_track', label: 'Auto-Track' },
  { id: 'backend', label: 'Backend' },
] as const;

export interface SystemConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SystemConfigDialog(props: SystemConfigDialogProps) {
  const [entries, setEntries] = createSignal<SystemConfigEntry[]>([]);
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
  const [editingKey, setEditingKey] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  const groupedEntries = createMemo(() =>
    groupSystemConfigEntries(entries(), activeCategory()),
  );

  const intro = createMemo(() => {
    const cat = activeCategory();
    if (!cat) {
      return {
        title: 'Paramètres opérationnels',
        description:
          'Réglages internes des services (worker, surveillance, auto-track, backend). Les modifications sont prises en compte au prochain cycle — aucun redémarrage requis.',
      };
    }
    const meta = SYSTEM_CONFIG_CATEGORY_META[cat];
    return {
      title: meta?.label ?? cat,
      description:
        meta?.description ??
        'Paramètres de cette catégorie. Modifiable en direct.',
    };
  });

  const entryCount = createMemo(() => {
    const cat = activeCategory();
    if (!cat) return entries().length;
    return entries().filter((e) => e.category === cat).length;
  });

  async function load() {
    try {
      const all = await api<SystemConfigEntry[]>('/system-config');
      setEntries(all);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger la configuration système.',
      );
    }
  }

  createEffect(() => {
    if (props.open) {
      setActiveCategory(null);
      setEditingKey(null);
      setError(null);
      setSuccess(null);
      void load();
    }
  });

  async function handleSave(key: string, value?: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/system-config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: value ?? editValue() }),
      });
      setEditingKey(null);
      const meta = getSystemConfigMeta(key);
      setSuccess(`« ${meta.label} » mis à jour.`);
      void load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Échec de l'enregistrement.",
      );
    } finally {
      setSaving(false);
    }
  }

  function isBooleanEnabled(value: string): boolean {
    return value === 'true' || value === '1';
  }

  async function handleSeed() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api('/system-config/seed', { method: 'POST' });
      setSuccess('Clés manquantes réinjectées avec les valeurs par défaut.');
      void load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Échec de la réinitialisation.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Configuration système"
      titleId="system-config-dialog-title"
      class="dialog-settings dialog-env-settings"
      bodyClass="dialog-body-settings"
    >
      <div class="settings-tab-intro">
        <h3 class="settings-tab-intro-title">{intro().title}</h3>
        <p class="settings-tab-intro-desc">{intro().description}</p>
        <p class="sys-config-count">
          {entryCount()} paramètre{entryCount() > 1 ? 's' : ''}
        </p>
      </div>

      <nav class="settings-tabs" role="tablist" aria-label="Catégories">
        <button
          type="button"
          class="settings-tab"
          classList={{ active: activeCategory() === null }}
          role="tab"
          aria-selected={activeCategory() === null}
          onClick={() => setActiveCategory(null)}
        >
          Toutes
        </button>
        <For each={CATEGORIES}>
          {(cat) => (
            <button
              type="button"
              class="settings-tab"
              classList={{ active: activeCategory() === cat.id }}
              role="tab"
              aria-selected={activeCategory() === cat.id}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          )}
        </For>
      </nav>

      <div class="settings-scroll">
        <Show
          when={groupedEntries().length > 0}
          fallback={
            <div class="empty-state">
              {error() ?? 'Aucun paramètre dans cette catégorie.'}
            </div>
          }
        >
          <For each={groupedEntries()}>
            {(group) => (
              <section class="settings-section settings-section-full sys-config-group">
                <h3 class="settings-section-title">{group.label}</h3>
                <div class="sys-config-list">
                  <For each={group.entries}>
                    {(entry) => {
                      const meta = () => getSystemConfigMeta(entry.key);
                      const formattedValue = () =>
                        formatSystemConfigValue(
                          entry.value,
                          meta().unit,
                          meta().unitLabel,
                        );

                      return (
                        <article class="sys-config-item">
                          <div class="sys-config-item-main">
                            <div class="sys-config-item-text">
                              <h4 class="sys-config-item-label">
                                {meta().label}
                              </h4>
                              <p class="form-hint">{meta().hint}</p>
                              <code class="sys-config-item-key" title={entry.key}>
                                {entry.key}
                              </code>
                            </div>

                            <div class="sys-config-item-control">
                              <Show
                                when={meta().unit === 'boolean'}
                                fallback={
                                  <>
                                    <Show
                                      when={editingKey() === entry.key}
                                      fallback={
                                        <div class="sys-config-value-display">
                                          <span class="sys-config-value">
                                            {formattedValue()}
                                          </span>
                                          <span class="sys-config-raw-value">
                                            brut : {entry.value}
                                          </span>
                                        </div>
                                      }
                                    >
                                      <input
                                        type="text"
                                        class="form-input sys-config-edit-input"
                                        value={editValue()}
                                        onInput={(e) =>
                                          setEditValue(e.currentTarget.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter')
                                            void handleSave(entry.key);
                                          if (e.key === 'Escape')
                                            setEditingKey(null);
                                        }}
                                        aria-label={`Valeur pour ${meta().label}`}
                                        autofocus
                                      />
                                    </Show>

                                    <div class="sys-config-item-actions">
                                      <Show
                                        when={editingKey() === entry.key}
                                        fallback={
                                          <button
                                            type="button"
                                            class="btn btn-secondary btn-sm"
                                            onClick={() => {
                                              setEditingKey(entry.key);
                                              setEditValue(entry.value);
                                            }}
                                          >
                                            Modifier
                                          </button>
                                        }
                                      >
                                        <button
                                          type="button"
                                          class="btn btn-primary btn-sm"
                                          disabled={saving()}
                                          onClick={() =>
                                            void handleSave(entry.key)
                                          }
                                        >
                                          {saving() ? '…' : 'Enregistrer'}
                                        </button>
                                        <button
                                          type="button"
                                          class="btn btn-secondary btn-sm"
                                          onClick={() => setEditingKey(null)}
                                        >
                                          Annuler
                                        </button>
                                      </Show>
                                    </div>
                                  </>
                                }
                              >
                                <div class="sys-config-value-display">
                                  <label class="toggle-switch">
                                    <input
                                      type="checkbox"
                                      checked={isBooleanEnabled(entry.value)}
                                      disabled={saving()}
                                      onChange={(e) => {
                                        void handleSave(
                                          entry.key,
                                          e.currentTarget.checked
                                            ? 'true'
                                            : 'false',
                                        );
                                      }}
                                      aria-label={meta().label}
                                    />
                                    <span class="toggle-track" />
                                    <span class="toggle-label">
                                      {formattedValue()}
                                    </span>
                                  </label>
                                </div>
                              </Show>
                            </div>
                          </div>
                        </article>
                      );
                    }}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </div>

      <div class="settings-footer settings-footer-actions">
        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>
        <Show when={success()}>
          <p class="form-success">{success()}</p>
        </Show>
        <p class="form-hint sys-config-footer-hint">
          Les valeurs sont stockées en base. « Réinitialiser les defaults »
          ajoute uniquement les clés absentes — les valeurs déjà modifiées ne
          sont pas écrasées.
        </p>
        <div class="settings-footer-buttons">
          <button
            type="button"
            class="btn btn-secondary"
            disabled={saving()}
            onClick={() => void handleSeed()}
          >
            Réinitialiser les defaults
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => props.onClose()}
          >
            Fermer
          </button>
        </div>
      </div>
    </Dialog>
  );
}
