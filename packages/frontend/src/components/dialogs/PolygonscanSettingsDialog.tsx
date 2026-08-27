import { createEffect, createSignal, on, Show } from 'solid-js';
import {
  clearPolygonscanApiKey,
  fetchPolygonscanSettingsStatus,
  savePolygonscanApiKey,
  type PolygonscanSettingsStatus,
} from '../../lib/integration-settings';
import { Dialog } from '../Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export function PolygonscanSettingsDialog(props: Props) {
  const [status, setStatus] = createSignal<PolygonscanSettingsStatus | null>(null);
  const [apiKey, setApiKey] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [clearing, setClearing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setStatus(await fetchPolygonscanSettingsStatus());
      setApiKey('');
      setError(null);
    } catch {
      setError('Impossible de charger la configuration Polygonscan.');
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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      setStatus(await savePolygonscanApiKey(apiKey()));
      setApiKey('');
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

  async function removeStoredKey() {
    setClearing(true);
    setError(null);
    try {
      await clearPolygonscanApiKey();
      await load();
      if (props.onSaved) await props.onSaved();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Échec de la suppression : ${err.message}`
          : 'Échec de la suppression.',
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Configuration Polygonscan"
      titleId="polygonscan-settings-dialog-title"
      class="dialog-settings"
      bodyClass="dialog-body-settings"
    >
      <Show
        when={!loading() && status()}
        fallback={
          <div class="empty-state">
            {loading() ? 'Chargement…' : (error() ?? 'Chargement…')}
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
              Clé API Etherscan v2 (chainid=137) pour l&apos;analyse on-chain des
              dépôts wallet sur les profils traders. Obtenez une clé sur{' '}
              <a
                href="https://etherscan.io/apidashboard"
                target="_blank"
                rel="noopener noreferrer"
              >
                etherscan.io/apidashboard
              </a>
              .
            </p>

            <Show when={current().envConfigured}>
              <div class="alert alert-warning">
                Clé active via la variable d&apos;environnement{' '}
                <code>POLYGONSCAN_API_KEY</code> sur le serveur. La configuration
                UI est en lecture seule tant que cette variable est définie.
              </div>
            </Show>

            <Show when={!current().envConfigured}>
              <div class="creds-field">
                <div class="creds-field-label-row">
                  <span class="creds-field-label">Clé API Polygonscan</span>
                  <span
                    class={`badge ${current().configured ? 'success' : 'neutral'}`}
                  >
                    {current().configured ? 'Configurée' : 'Non renseignée'}
                  </span>
                </div>
                <input
                  class="input input-mono"
                  type="password"
                  placeholder="Coller votre clé API"
                  value={apiKey()}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                />
                <p class="form-hint">
                  La clé est chiffrée côté serveur. Saisissez une nouvelle clé pour
                  remplacer celle enregistrée.
                </p>
              </div>
            </Show>

            <Show when={error()}>
              <p class="form-error">{error()}</p>
            </Show>

            <div class="dialog-actions">
              <Show when={current().hasStoredKey && !current().envConfigured}>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  disabled={clearing() || saving()}
                  onClick={() => void removeStoredKey()}
                >
                  {clearing() ? 'Suppression…' : 'Supprimer la clé'}
                </button>
              </Show>
              <span style={{ flex: '1' }} />
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onClick={() => props.onClose()}
              >
                {current().envConfigured ? 'Fermer' : 'Annuler'}
              </button>
              <Show when={!current().envConfigured}>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={saving() || !apiKey().trim()}
                  onClick={() => void save()}
                >
                  {saving() ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
