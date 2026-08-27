import { createEffect, createSignal, on, Show } from 'solid-js';
import {
  fetchMarketSyncConfig,
  saveMarketSyncConfig,
  type MarketSyncConfig,
} from '../lib/market-sync-config';
import { Dialog } from './Dialog';
import { NumberField } from './settings/settings-fields';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export function MarketSyncSettingsDialog(props: Props) {
  const [config, setConfig] = createSignal<MarketSyncConfig | null>(null);
  const [draft, setDraft] = createSignal<MarketSyncConfig | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchMarketSyncConfig();
      setConfig(data);
      setDraft({ ...data });
      setError(null);
    } catch {
      setError('Impossible de charger la configuration de synchronisation.');
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setError(null);
        void load();
      },
    ),
  );

  function updateField<K extends keyof MarketSyncConfig>(
    key: K,
    value: MarketSyncConfig[K],
  ) {
    const current = draft();
    if (!current) return;
    setDraft({ ...current, [key]: value });
  }

  async function save() {
    const d = draft();
    if (!d) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveMarketSyncConfig(d);
      setConfig(updated);
      setDraft({ ...updated });
      if (props.onSaved) await props.onSaved();
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

  const hasChanges = () => {
    const c = config();
    const d = draft();
    if (!c || !d) return false;
    return (
      c.maxMarketsPerCycle !== d.maxMarketsPerCycle ||
      c.defaultFidelityMinutes !== d.defaultFidelityMinutes ||
      c.expirationFidelityMinutes !== d.expirationFidelityMinutes ||
      c.hourlySyncIntervalMs !== d.hourlySyncIntervalMs ||
      c.expirationIntervalMs !== d.expirationIntervalMs ||
      c.tickRetentionDays !== d.tickRetentionDays
    );
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Synchronisation des marchés"
      titleId="market-sync-settings-dialog-title"
      class="dialog-settings"
      bodyClass="dialog-body-settings dialog-body-scroll"
    >
      <Show
        when={!loading() && draft()}
        fallback={
          <div class="empty-state">
            {loading() ? 'Chargement…' : error() ?? 'Chargement…'}
            <Show when={error() && !loading()}>
              <button
                class="btn btn-secondary btn-sm"
                style={{ 'margin-top': '0.5rem' }}
                type="button"
                onClick={() => void load()}
              >
                Réessayer
              </button>
            </Show>
          </div>
        }
      >
        {(current) => (
          <div class="form-stack">
            <p class="form-hint settings-intro">
              Configurez la synchronisation de l&apos;historique des prix
              Polymarket pour les marchés non-crypto. Les paramètres sont
              appliqués au prochain cycle de synchronisation.
            </p>

            <section class="settings-section settings-section-full">
              <h3 class="settings-section-title">Cycle horaire</h3>

              <NumberField
                label="Marchés max par cycle"
                value={current().maxMarketsPerCycle}
                min={1}
                max={100}
                step={1}
                hint="Nombre maximum de marchés synchronisés à chaque cycle horaire."
                onChange={(v) => updateField('maxMarketsPerCycle', v)}
              />

              <NumberField
                label="Intervalle du cycle (ms)"
                value={current().hourlySyncIntervalMs}
                min={60_000}
                max={86_400_000}
                step={60_000}
                hint="Intervalle entre deux cycles de synchronisation. 3 600 000 ms = 1 heure."
                onChange={(v) => updateField('hourlySyncIntervalMs', v)}
              />

              <NumberField
                label="Fidélité par défaut (minutes)"
                value={current().defaultFidelityMinutes}
                min={1}
                max={1440}
                step={1}
                hint="Résolution des points de prix pour la sync normale. 60 = 1 point par heure."
                onChange={(v) => updateField('defaultFidelityMinutes', v)}
              />
            </section>

            <section class="settings-section settings-section-full">
              <h3 class="settings-section-title">Sync à l'expiration</h3>

              <NumberField
                label="Intervalle de vérification (ms)"
                value={current().expirationIntervalMs}
                min={5_000}
                max={3_600_000}
                step={5_000}
                hint="Fréquence à laquelle le worker vérifie les marchés expirés. 60 000 ms = 60 secondes."
                onChange={(v) => updateField('expirationIntervalMs', v)}
              />

              <NumberField
                label="Fidélité expiration (minutes)"
                value={current().expirationFidelityMinutes}
                min={1}
                max={1440}
                step={1}
                hint="Résolution fine pour le dernier relevé à l'expiration. 1 = 1 point par minute."
                onChange={(v) => updateField('expirationFidelityMinutes', v)}
              />
            </section>

            <section class="settings-section settings-section-full">
              <h3 class="settings-section-title">Nettoyage</h3>

              <NumberField
                label="Rétention des ticks (jours)"
                value={current().tickRetentionDays}
                min={0}
                max={365}
                step={1}
                hint="Supprime les points de prix plus vieux que N jours. 0 = pas de purge."
                onChange={(v) => updateField('tickRetentionDays', v)}
              />
            </section>

            <Show when={error()}>
              <p class="form-error">{error()}</p>
            </Show>

            <div class="dialog-actions">
              <span style={{ flex: '1' }} />
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
                disabled={saving() || !hasChanges()}
                onClick={() => void save()}
              >
                {saving() ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
