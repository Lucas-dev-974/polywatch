import { createEffect, createSignal, Show } from 'solid-js';
import { rotateRealPeriod, type RealPeriodRotateResult } from '../../lib/real-sessions';
import { Dialog } from '../Dialog';

export interface RealPeriodCloseDialogProps {
  open: boolean;
  onClose: () => void;
  onDone?: (result: RealPeriodRotateResult | null) => void;
}

export function RealPeriodCloseDialog(props: RealPeriodCloseDialogProps) {
  const [label, setLabel] = createSignal('');
  const [archive, setArchive] = createSignal(true);
  const [clearClosedLive, setClearClosedLive] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setError(null);
    setLabel('');
    setArchive(true);
    setClearClosedLive(false);
  });

  async function confirmClose() {
    setLoading(true);
    setError(null);
    try {
      const result = await rotateRealPeriod({
        archive: archive(),
        clearClosedLive: clearClosedLive(),
        newPeriodLabel: label().trim() || null,
      });
      props.onDone?.(result);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la clôture');
      props.onDone?.(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Clôturer la période"
      titleId="real-period-close-dialog-title"
      class="dialog-creds real-period-close-dialog"
    >
      <div class="form-stack">
        <p class="form-hint">
          Borne la période courante et démarre une nouvelle avec baseline = equity
          observée. Le wallet et les positions ouvertes ne sont jamais modifiés.
        </p>
        <ul class="form-hint real-period-close-list">
          <li>Un snapshot « Avant clôture de période » est créé si la période a de l’activité</li>
          <li>Archivage : positions fermées dans la fenêtre de période</li>
          <Show when={clearClosedLive()}>
            <li>
              Les positions fermées archivées seront retirées de l’onglet Activité (ledger
              live)
            </li>
          </Show>
        </ul>

        <label class="form-field">
          <span class="form-label">Label de la nouvelle période</span>
          <input
            class="input"
            type="text"
            maxlength={200}
            placeholder="Ex. Q3 2026"
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
          />
        </label>

        <label class="form-field checkbox-field">
          <input
            type="checkbox"
            checked={archive()}
            onChange={(e) => setArchive(e.currentTarget.checked)}
          />
          <span>Archiver les positions fermées de la période</span>
        </label>

        <label class="form-field checkbox-field">
          <input
            type="checkbox"
            checked={clearClosedLive()}
            onChange={(e) => setClearClosedLive(e.currentTarget.checked)}
          />
          <span>
            Retirer les positions fermées archivées de l’Activité (défaut : non — ledger
            live conservé)
          </span>
        </label>

        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>

        <div class="dialog-actions">
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
            class="btn btn-primary btn-sm"
            disabled={loading()}
            onClick={() => void confirmClose()}
          >
            {loading() ? 'Clôture…' : 'Clôturer la période'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
