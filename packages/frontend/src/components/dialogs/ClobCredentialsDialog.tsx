import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { truncateAddress } from '../../lib/address';
import {
  BUILDER_FORM_FIELDS,
  CLOB_FORM_FIELDS,
  countBuilderFieldsSaved,
  countL2FieldsSaved,
  credsFromStatus,
  emptyClobCredentials,
  fetchClobCredentialsStatus,
  saveClobCredentials,
  SIGNATURE_TYPE_OPTIONS,
  type ClobCredentialsForm,
  type ClobCredentialsStatus,
} from '../../lib/clob-credentials';
import { CredsFieldList } from '../CredsFieldList';
import { Dialog } from '../Dialog';
import { MetaMaskButton } from '../MetaMaskButton';
import { useFormSave } from '../../hooks/useFormSave';

interface ClobCredentialsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ClobCredentialsDialog(props: ClobCredentialsDialogProps) {
  const { saving, runSave, saveLabel } = useFormSave();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [creds, setCreds] = createSignal<ClobCredentialsForm>(emptyClobCredentials());
  const [existing, setExisting] = createSignal<ClobCredentialsStatus | null>(null);

  async function loadExisting() {
    if (!props.open) return;
    setLoading(true);
    try {
      const status = await fetchClobCredentialsStatus();
      setExisting(status);
      setCreds(credsFromStatus(status));
      setError(null);
    } catch {
      setError('Impossible de charger le statut des credentials.');
    } finally {
      setLoading(false);
    }
  }

  createEffect(on(() => props.open, (open) => { if (open) void loadExisting(); }));

  function applyMetaMaskAddress(address: string) {
    setCreds((prev) => ({ ...prev, funderAddress: address }));
  }

  onMount(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    const handler = (accounts: unknown) => {
      const accs = accounts as string[];
      if (accs.length > 0) applyMetaMaskAddress(accs[0].toLowerCase());
    };
    window.ethereum.on('accountsChanged', handler);
    onCleanup(() => {
      window.ethereum?.removeListener('accountsChanged', handler);
    });
  });

  function updateField(key: keyof ClobCredentialsForm, value: string) {
    setCreds((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    await runSave(async () => {
      setError(null);
      try {
        await saveClobCredentials(creds());
        await loadExisting();
        props.onClose();
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? `Échec de l'enregistrement : ${err.message}`
            : "Échec de l'enregistrement.",
        );
      }
    });
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Configurer CLOB"
      titleId="clob-dialog-title"
      class="dialog-creds"
      bodyClass="dialog-body-creds"
    >
      <p class="form-hint">
        Credentials L2, signer et Builder pour le trading reel et les retraits L2.
        Les valeurs sensibles sont chiffrees cote serveur. Laissez un champ vide
        pour conserver la valeur deja enregistree.
      </p>

      <Show when={!loading() && existing()?.configured}>
        <div class="creds-status-summary">
          <span class="creds-status-summary-label">Etat L2</span>
          <span class={`badge ${countL2FieldsSaved(existing()) === 3 ? 'success' : 'warn'}`}>
            {countL2FieldsSaved(existing())}/3 champs L2
          </span>
          <span class="creds-status-summary-label">Builder</span>
          <span class={`badge ${countBuilderFieldsSaved(existing()) === 3 ? 'success' : 'warn'}`}>
            {countBuilderFieldsSaved(existing())}/3 champs Builder
          </span>
        </div>
      </Show>

      <div class="metamask-section">
        <span class="metamask-section-label">EOA MetaMask</span>
        <MetaMaskButton onConnected={applyMetaMaskAddress} />
        <Show when={creds().funderAddress}>
          <span class="metamask-connected">
            Connecte ({truncateAddress(creds().funderAddress)})
          </span>
        </Show>
      </div>

      <div class="creds-form">
        <CredsFieldList
          fields={CLOB_FORM_FIELDS}
          creds={creds()}
          existing={existing()}
          onFieldChange={updateField}
        />
        <div class="creds-field">
          <span class="creds-field-label">Type de signature</span>
          <select
            class="input input-mono"
            value={creds().signatureType}
            onChange={(e) => updateField('signatureType', e.currentTarget.value)}
          >
            <For each={SIGNATURE_TYPE_OPTIONS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
        </div>
      </div>

      <span class="creds-section-label">Relayer Builder (retrait L2)</span>
      <div class="creds-form">
        <CredsFieldList
          fields={BUILDER_FORM_FIELDS}
          creds={creds()}
          existing={existing()}
          onFieldChange={updateField}
        />
      </div>

      <Show when={error()}>
        <p class="form-error">{error()}</p>
      </Show>
      <button
        class="btn btn-primary btn-block"
        disabled={saving() || loading()}
        onClick={() => void save()}
      >
        {saveLabel('Enregistrer credentials', 'Enregistrement...')}
      </button>
    </Dialog>
  );
}
