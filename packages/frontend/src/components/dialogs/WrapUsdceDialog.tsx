import { createEffect, createSignal, on, Show } from 'solid-js';
import {
  amountToRaw6Decimals,
  formatPusdAmount,
} from '@polywatch/core/polymarket/pusd-amount';
import { truncateAddress } from '../../lib/address';
import { mapPusdTransferError } from '../../lib/pusd-errors';
import { submitWalletWrap, wrapButtonLabel } from '../../lib/wallet-transfer';
import type { WalletAccountView } from '../../lib/wallet';
import { Dialog } from '../Dialog';

interface WrapUsdceDialogProps {
  open: boolean;
  account: WalletAccountView;
  onClose: () => void;
  onSuccess: () => void;
}

export function WrapUsdceDialog(props: WrapUsdceDialogProps) {
  const [amount, setAmount] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [inProgress, setInProgress] = createSignal(false);
  const [txHash, setTxHash] = createSignal<string | null>(null);

  createEffect(
    on(
      () => [props.open, props.account] as const,
      ([open, account]) => {
        if (!open) return;
        setAmount(
          account.usdcEBalance != null && account.usdcEBalance > 0
            ? formatPusdAmount(amountToRaw6Decimals(account.usdcEBalance))
            : '',
        );
        setError(null);
        setInProgress(false);
        setTxHash(null);
      },
    ),
  );

  async function submit() {
    setError(null);
    setInProgress(false);
    setSubmitting(true);
    try {
      setTxHash(await submitWalletWrap(props.account, amount()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      if (msg === 'withdraw_in_progress' || msg.startsWith('withdraw_in_progress:')) {
        setInProgress(true);
        setError(null);
      } else {
        setError(mapPusdTransferError(msg));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (txHash()) {
      props.onSuccess();
    }
    props.onClose();
  }

  return (
    <Dialog
      open={props.open}
      onClose={() => handleClose()}
      title="Convertir USDC.e en pUSD"
      titleId="wrap-usdce-dialog-title"
      class="dialog-creds"
      bodyClass="dialog-body-creds"
    >
      <p class="form-hint">
        Conversion 1:1 sur le depot Polymarket {truncateAddress(props.account.depositAddress)}.
        Les USDC.e deviennent du pUSD sur cette meme adresse — rien n'est envoye vers MetaMask.
      </p>

      <label class="form-field">
        <span>Montant (USDC.e)</span>
        <input
          class="input input-mono"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          value={amount()}
          onInput={(e) => setAmount(e.currentTarget.value)}
        />
      </label>

      <Show when={props.account.usdcEBalance != null}>
        <p class="form-hint">
          Solde USDC.e disponible :{' '}
          {props.account.usdcEBalance!.toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}{' '}
          USDC.e
        </p>
      </Show>

      <Show when={error()}>
        <p class="form-error">{error()}</p>
      </Show>

      <Show when={inProgress()}>
        <p class="form-hint">
          Une conversion identique est deja en cours d'execution. Patientez quelques
          secondes puis rechargez les soldes — pas besoin de relancer.
        </p>
      </Show>

      <Show when={txHash()}>
        <p class="form-hint">
          Transaction soumise (pUSD) :{' '}
          <a
            href={`https://polygonscan.com/tx/${txHash()}`}
            target="_blank"
            rel="noopener noreferrer"
            class="text-mono"
          >
            {truncateAddress(txHash()!)}
          </a>
        </p>
      </Show>

      <button
        class="btn btn-primary btn-block"
        disabled={submitting() || !!txHash()}
        onClick={() => void submit()}
      >
        {submitting() ? 'En cours...' : wrapButtonLabel(props.account)}
      </button>
    </Dialog>
  );
}
