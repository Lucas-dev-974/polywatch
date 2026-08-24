import { createSignal, Show } from 'solid-js';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Titre de la fenêtre. */
  title: string;
  /** Info affichée au-dessus du formulaire (real seulement). */
  hint?: string;
  /** Créer le snapshot (appelle la lib sim ou real). */
  onCreate: (label: string | undefined) => Promise<unknown>;
}

export function SnapshotDialog(props: Props) {
  const [label, setLabel] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const trimmed = label().trim();
      await props.onCreate(trimmed || undefined);
      setLabel('');
      props.onCreated();
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      titleId="snapshot-dialog-title"
      class="dialog-creds"
    >
      <div class="form-stack">
        {props.hint ? <p class="form-hint">{props.hint}</p> : null}
        <label class="form-field">
          <span class="form-label">Label (optionnel)</span>
          <input
            class="input"
            type="text"
            maxlength={200}
            placeholder="Ex. avant changement SL"
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
          />
        </label>
        <Show when={error()}>
          <p class="form-hint form-hint-error">{error()}</p>
        </Show>
        <div class="dialog-actions">
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
            disabled={saving()}
            onClick={() => void save()}
          >
            {saving() ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
