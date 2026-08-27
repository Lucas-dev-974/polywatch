import { For, Show } from 'solid-js';
import {
  WITHDRAW_OUTPUT_OPTIONS,
  WITHDRAW_RECIPIENT_CUSTOM,
  type WithdrawOutputAsset,
  type WithdrawRecipientOption,
} from '../../lib/wallet';
import { truncateAddress } from '../../lib/address';

interface WithdrawTransferFieldsProps {
  amount: string;
  outputAsset: WithdrawOutputAsset;
  recipientKey: string;
  customRecipient: string;
  recipientOptions: WithdrawRecipientOption[];
  onAmountChange: (value: string) => void;
  onOutputAssetChange: (value: WithdrawOutputAsset) => void;
  onRecipientKeyChange: (value: string) => void;
  onCustomRecipientChange: (value: string) => void;
}

export function WithdrawTransferFields(props: WithdrawTransferFieldsProps) {
  return (
    <>
      <label class="form-field">
        <span>Montant (pUSD)</span>
        <input
          class="input input-mono"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          value={props.amount}
          onInput={(e) => props.onAmountChange(e.currentTarget.value)}
        />
      </label>

      <label class="form-field">
        <span>Recevoir en</span>
        <select
          class="select input-mono"
          value={props.outputAsset}
          onChange={(e) =>
            props.onOutputAssetChange(e.currentTarget.value as WithdrawOutputAsset)
          }
        >
          <For each={WITHDRAW_OUTPUT_OPTIONS}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </label>

      <label class="form-field">
        <span>Destinataire</span>
        <select
          class="select input-mono"
          value={props.recipientKey}
          onChange={(e) => props.onRecipientKeyChange(e.currentTarget.value)}
        >
          <For each={props.recipientOptions}>
            {(opt) => (
              <option value={opt.id}>
                {opt.label} ({truncateAddress(opt.address)})
              </option>
            )}
          </For>
          <option value={WITHDRAW_RECIPIENT_CUSTOM}>Autre adresse...</option>
        </select>
      </label>

      <Show when={props.recipientKey === WITHDRAW_RECIPIENT_CUSTOM}>
        <label class="form-field">
          <span>Adresse personnalisee</span>
          <input
            class="input input-mono"
            type="text"
            placeholder="0x..."
            value={props.customRecipient}
            onInput={(e) => props.onCustomRecipientChange(e.currentTarget.value)}
          />
        </label>
      </Show>
    </>
  );
}
