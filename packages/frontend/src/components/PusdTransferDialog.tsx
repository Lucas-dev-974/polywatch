import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { truncateAddress } from '../lib/address';
import { depositPusdViaMetaMask } from '../lib/pusd-transfer';
import { mapPusdTransferError, pusdTransferHint } from '../lib/pusd-errors';
import {
  receivedTokenLabel,
  submitWalletWithdraw,
  validateTransferAmount,
  withdrawButtonLabel,
} from '../lib/wallet-transfer';
import {
  defaultWithdrawRecipientKey,
  withdrawRecipientOptions,
  type DepositTab,
  type WalletAccountView,
  type WalletData,
  type WithdrawOutputAsset,
} from '../lib/wallet';
import { BridgeDepositPanel } from './BridgeDepositPanel';
import { Dialog } from './Dialog';
import { MetaMaskButton } from './MetaMaskButton';
import { PusdTransferSummary } from './PusdTransferSummary';
import { WithdrawTransferFields } from './WithdrawTransferFields';

export type PusdTransferMode = 'deposit' | 'withdraw';

interface PusdTransferDialogProps {
  open: boolean;
  mode: PusdTransferMode;
  wallet: WalletData;
  account: WalletAccountView;
  onClose: () => void;
  onSuccess: () => void;
}

const DEPOSIT_TABS: { id: DepositTab; label: string }[] = [
  { id: 'metamask', label: 'pUSD MetaMask' },
  { id: 'bridge', label: 'Bridge multi-chaînes' },
];

export function PusdTransferDialog(props: PusdTransferDialogProps) {
  const [amount, setAmount] = createSignal('');
  const [recipientKey, setRecipientKey] = createSignal('');
  const [customRecipient, setCustomRecipient] = createSignal('');
  const [outputAsset, setOutputAsset] = createSignal<WithdrawOutputAsset>('usdc_e');
  const [depositTab, setDepositTab] = createSignal<DepositTab>('metamask');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [inProgress, setInProgress] = createSignal(false);
  const [txHash, setTxHash] = createSignal<string | null>(null);
  const [bridgeCompleted, setBridgeCompleted] = createSignal(false);
  const [connectedAccount, setConnectedAccount] = createSignal<string | null>(null);

  const isDeposit = () => props.mode === 'deposit';
  const recipientOptions = createMemo(() =>
    withdrawRecipientOptions(props.account, props.wallet.accounts),
  );

  createEffect(
    on(
      () => [props.open, props.account, props.wallet.accounts] as const,
      ([open, account, allAccounts]) => {
        if (!open) return;
        setAmount('');
        setRecipientKey(defaultWithdrawRecipientKey(account, allAccounts));
        setCustomRecipient('');
        setOutputAsset('usdc_e');
        setDepositTab('metamask');
        setError(null);
        setInProgress(false);
        setTxHash(null);
        setBridgeCompleted(false);
        setConnectedAccount(null);
      },
    ),
  );

  async function submitDeposit() {
    const parsed = validateTransferAmount(amount());
    if (!props.account.depositAddress) throw new Error('Wallet de depot manquant');
    setTxHash(await depositPusdViaMetaMask(props.account.depositAddress, parsed));
  }

  async function submitWithdraw() {
    setTxHash(
      await submitWalletWithdraw(
        props.wallet,
        props.account,
        amount(),
        recipientKey(),
        customRecipient(),
        outputAsset(),
      ),
    );
  }

  function handleClose() {
    if (txHash() || bridgeCompleted()) {
      props.onSuccess();
    }
    props.onClose();
  }

  async function submit() {
    setError(null);
    setInProgress(false);
    setSubmitting(true);
    try {
      if (isDeposit()) {
        await submitDeposit();
      } else {
        await submitWithdraw();
      }
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

  return (
    <Dialog
      open={props.open}
      onClose={() => handleClose()}
      title={isDeposit() ? 'Verser des fonds' : 'Retirer des fonds'}
      titleId={isDeposit() ? 'pusd-deposit-dialog-title' : 'pusd-withdraw-dialog-title'}
      class="dialog-creds"
      bodyClass="dialog-body-creds"
    >
      <Show when={isDeposit()}>
        <div class="pusd-transfer-tabs">
          <For each={DEPOSIT_TABS}>
            {(tab) => (
              <button
                type="button"
                class="pusd-transfer-tab"
                classList={{ 'pusd-transfer-tab-active': depositTab() === tab.id }}
                onClick={() => setDepositTab(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      <p class="form-hint">
        {pusdTransferHint(
          props.mode,
          props.account.isL2Deposit,
          outputAsset(),
          depositTab(),
        )}
      </p>

      <Show when={!isDeposit() && props.account.isL2Deposit && !props.account.hasBuilderCreds}>
        <p class="form-error">
          Credentials Builder non configures. Ouvrez Configurer CLOB dans l'onglet Reel.
        </p>
      </Show>

      <PusdTransferSummary account={props.account} />

      <Show when={isDeposit() && depositTab() === 'bridge'}>
        <BridgeDepositPanel
          active={props.open && depositTab() === 'bridge'}
          onCompleted={() => setBridgeCompleted(true)}
        />
      </Show>

      <Show when={!isDeposit() || depositTab() === 'metamask'}>
        <Show when={isDeposit()}>
          <div class="metamask-section">
            <span class="metamask-section-label">MetaMask</span>
            <MetaMaskButton onConnected={setConnectedAccount} />
            <Show when={connectedAccount()}>
              <span class="metamask-connected">
                Connecte ({truncateAddress(connectedAccount()!)})
              </span>
            </Show>
          </div>
        </Show>

        <Show
          when={!isDeposit()}
          fallback={
            <label class="form-field">
              <span>Montant (pUSD)</span>
              <input
                class="input input-mono"
                type="text"
                inputmode="decimal"
                placeholder="0.00"
                value={amount()}
                onInput={(e) => setAmount(e.currentTarget.value)}
              />
            </label>
          }
        >
          <WithdrawTransferFields
            amount={amount()}
            outputAsset={outputAsset()}
            recipientKey={recipientKey()}
            customRecipient={customRecipient()}
            recipientOptions={recipientOptions()}
            onAmountChange={setAmount}
            onOutputAssetChange={setOutputAsset}
            onRecipientKeyChange={setRecipientKey}
            onCustomRecipientChange={setCustomRecipient}
          />
        </Show>

        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>

        <Show when={inProgress()}>
          <p class="form-hint">
            Un retrait identique est deja en cours d'execution. Patientez quelques
            secondes puis rechargez les soldes — pas besoin de relancer.
          </p>
        </Show>

        <Show when={txHash()}>
          <p class="form-hint">
            Transaction soumise ({receivedTokenLabel(props.mode, outputAsset())}) :{' '}
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
          {submitting()
            ? 'En cours...'
            : isDeposit()
              ? 'Verser via MetaMask'
              : withdrawButtonLabel(outputAsset(), props.account)}
        </button>
      </Show>
    </Dialog>
  );
}
