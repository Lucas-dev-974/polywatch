import { createEffect, createSignal, Show } from 'solid-js';
import {
  fetchSimInitialCapital,
  formatSimCapital,
  resetSimulation,
  type SimResetResult,
} from '../lib/simulation';
import { Dialog } from './Dialog';

export interface WeatherAlgoResetDialogProps {
  open: boolean;
  onClose: () => void;
  onDone?: (result: SimResetResult | null) => void;
}

export function WeatherAlgoResetDialog(props: WeatherAlgoResetDialogProps) {
  const [label, setLabel] = createSignal('');
  const [capital, setCapital] = createSignal<number | null>(null);
  const [archive, setArchive] = createSignal(true);
  const [deepClean, setDeepClean] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setError(null);
    setLabel('');
    setArchive(true);
    setDeepClean(false);
    void fetchSimInitialCapital('weather')
      .then(setCapital)
      .catch(() => setCapital(null));
  });

  async function confirmReset() {
    setLoading(true);
    setError(null);
    try {
      const amount = capital();
      if (amount == null || amount < 0) {
        throw new Error('Capital initial indisponible');
      }
      const result = await resetSimulation({
        algoKind: 'weather',
        amount,
        archive: archive(),
        deepClean: deepClean(),
        newSessionLabel: label().trim() || null,
      });
      props.onDone?.(result);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la réinitialisation');
      props.onDone?.(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Réinitialiser la simulation weather"
      titleId="weather-algo-reset-dialog-title"
      class="dialog-creds weather-algo-reset-dialog"
      bodyClass="weather-algo-reset-body"
    >
      <div class="weather-algo-reset-layout">
        <div class="weather-algo-reset-summary">
          <p>
            Archiver la session weather courante et réinitialiser la simulation.
            Un snapshot « Avant réinitialisation » est créé automatiquement si la session a de
            l'activité.
          </p>
          <ul class="weather-algo-reset-impacts">
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
                  <strong>Purge :</strong> ticks marché, surveillance terminée, historique prix
                </span>
              </li>
            </Show>
          </ul>
        </div>

        <div class="weather-algo-reset-fields">
          <label class="form-field">
            <span class="form-label">Label de la nouvelle session</span>
            <input
              class="input"
              type="text"
              maxlength={200}
              placeholder="Ex. Post-rapport 2026-08-04"
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

          <div class="weather-algo-reset-options">
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
              <span>Purger les données marché (base saine)</span>
            </label>
          </div>
        </div>

        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>

        <div class="dialog-actions weather-algo-reset-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            disabled={loading()}
            onClick={() => {
              props.onDone?.(null);
              props.onClose();
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-danger btn-sm"
            disabled={loading() || capital() == null}
            onClick={() => void confirmReset()}
          >
            {loading() ? 'Réinitialisation…' : 'Réinitialiser la simulation'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
