import { createSignal, Show } from 'solid-js';

import type { CredHintId } from '../lib/clob-credentials';

export type HintId = CredHintId;

const FIELD_HINTS: Record<CredHintId, string> = {
  wallet: 'Adresse du depot Polymarket (proxy L2) ou du wallet affiche sur polymarket.com.',
  apiKey: 'Generee depuis le dashboard Polymarket -> Developer -> API Keys. Cliquez sur "Create API Key".',
  secret: 'Fourni avec la cle API L2 lors de sa creation sur le dashboard Polymarket. Conservez-la precieusement.',
  passphrase: 'Phrase de passe que vous avez definie lors de la creation de la cle API L2 sur Polymarket.',
  signerPk: 'Cle privee d\'un wallet dedie au trading automatise. Creez un wallet separe - n\'utilisez JAMAIS votre wallet principal.',
  funder: 'Adresse EOA MetaMask qui controle le depot. Generalement votre wallet connecte sur Polymarket.',
  relayerUrl: 'URL du relayer Polymarket pour les retraits L2 gasless. Laissez la valeur par defaut sauf instruction contraire.',
  builderApiKey: 'Credentials Builder Polymarket (programme Builder). Necessaires pour retirer depuis un wallet L2.',
  builderSecret: 'Secret Builder fourni lors de la creation des credentials Builder Polymarket.',
  builderPassphrase: 'Passphrase Builder definie lors de la creation des credentials Builder Polymarket.',
};

interface CredFieldProps {
  label: string;
  placeholder: string;
  value?: string;
  type?: string;
  hintId: CredHintId;
  saved?: boolean;
  onInput: (v: string) => void;
}

export function CredField(props: CredFieldProps) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="creds-field">
      <div class="creds-field-label-row">
        <span class="creds-field-label">{props.label}</span>
        <Show when={props.saved !== undefined}>
          <span class={`badge ${props.saved ? 'success' : 'neutral'}`}>
            {props.saved ? 'Enregistré' : 'Non renseigné'}
          </span>
        </Show>
      </div>
      <div class="creds-field-row">
        <input
          class="input input-mono"
          placeholder={props.placeholder}
          value={props.value ?? ''}
          type={props.type ?? 'text'}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
        <button
          class="creds-hint-toggle"
          classList={{ 'is-open': open() }}
          onClick={() => setOpen(!open())}
          title="Ou trouver ce credential ?"
          type="button"
        >
          ?
        </button>
      </div>
      <div class="creds-hint" classList={{ 'is-visible': open() }} role="region">
        {FIELD_HINTS[props.hintId]}
      </div>
    </div>
  );
}