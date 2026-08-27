import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { truncateAddress } from '../../lib/address';
import { sendBridgeDepositViaMetaMask, chainExplorerTxUrl } from '../../lib/bridge-metamask';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';
import { hasMetaMask } from '../../lib/ethereum';
import { mapPusdTransferError } from '../../lib/pusd-errors';
import {
  BRIDGE_ADDRESS_LABELS,
  BRIDGE_DEPOSIT_CRYPTO_OPTIONS,
  bridgeStatusLabel,
  fetchBridgeDepositQuote,
  fetchBridgeDepositAddresses,
  fetchBridgeStatus,
  isBridgeStatusTerminal,
  type BridgeDepositAssetSymbol,
  type BridgeDepositQuote,
  type BridgeTransaction,
} from '../../lib/bridge';

interface BridgeDepositPanelProps {
  active: boolean;
  onCompleted: () => void;
}

const POLL_MS = 15_000;

export function BridgeDepositPanel(props: BridgeDepositPanelProps) {
  const [pusdAmount, setPusdAmount] = createSignal('');
  const [assetSymbol, setAssetSymbol] = createSignal<BridgeDepositAssetSymbol>('ETH');
  const [quote, setQuote] = createSignal<BridgeDepositQuote | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [quoting, setQuoting] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [txHash, setTxHash] = createSignal<string | null>(null);
  const copyFeedback = useCopyFeedback();
  const [transactions, setTransactions] = createSignal<BridgeTransaction[]>([]);

  const monitorAddress = () => quote()?.bridgeAddress ?? null;

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      await fetchBridgeDepositAddresses();
    } catch (err) {
      setError(mapPusdTransferError(err instanceof Error ? err.message : 'bridge_error'));
    } finally {
      setLoading(false);
    }
  }

  async function fetchQuote() {
    const amount = Number(pusdAmount().replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Montant pUSD invalide');
      return;
    }

    setQuoting(true);
    setError(null);
    setQuote(null);
    setTxHash(null);
    try {
      setQuote(await fetchBridgeDepositQuote(amount, assetSymbol()));
    } catch (err) {
      setError(mapPusdTransferError(err instanceof Error ? err.message : 'bridge_error'));
    } finally {
      setQuoting(false);
    }
  }

  async function pollStatus() {
    const addr = monitorAddress();
    if (!addr) return;
    try {
      const status = await fetchBridgeStatus(addr);
      setTransactions(status.transactions ?? []);
      if (status.transactions?.some((tx) => tx.status === 'COMPLETED')) {
        props.onCompleted();
      }
    } catch {
      // ignore transient poll errors
    }
  }

  async function sendViaMetaMask() {
    const q = quote();
    if (!q) {
      setError(mapPusdTransferError('bridge_quote_missing'));
      return;
    }
    if (!q.metamaskSupported) return;

    setSending(true);
    setError(null);
    try {
      const hash = await sendBridgeDepositViaMetaMask({
        chainId: Number(q.asset.chainId),
        bridgeAddress: q.bridgeAddress,
        tokenAddress: q.asset.token.address,
        fromAmountBaseUnit: q.fromAmountBaseUnit,
      });
      setTxHash(hash);
      void pollStatus();
    } catch (err) {
      setError(mapPusdTransferError(err instanceof Error ? err.message : 'Erreur MetaMask'));
    } finally {
      setSending(false);
    }
  }

  function copyDepositInstructions() {
    const q = quote();
    if (!q) return;
    const text = [
      `Montant : ${q.fromAmountFormatted} ${q.asset.token.symbol}`,
      `Reseau : ${q.asset.chainName}`,
      `Adresse bridge : ${q.bridgeAddress}`,
      `Objectif : ~${pusdAmount()} pUSD`,
    ].join('\n');
    void copyFeedback.copy(text);
  }

  createEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) return;
        setPusdAmount('');
        setAssetSymbol('ETH');
        setQuote(null);
        setError(null);
        setTxHash(null);
        setTransactions([]);
        void loadInitial();
      },
    ),
  );

  createEffect(
    on(
      () => [props.active, monitorAddress()] as const,
      ([active, addr]) => {
        if (!active || !addr) return;
        void pollStatus();
        const timer = setInterval(() => void pollStatus(), POLL_MS);
        onCleanup(() => clearInterval(timer));
      },
    ),
  );

  return (
    <div class="bridge-deposit">
      <p class="form-hint bridge-deposit-warning">
        Conversion automatique en pUSD sur votre wallet Polymarket apres reception bridge.
      </p>

      <label class="form-field">
        <span>Montant pUSD souhaite</span>
        <input
          class="input input-mono"
          type="text"
          inputmode="decimal"
          placeholder="100.00"
          value={pusdAmount()}
          onInput={(e) => setPusdAmount(e.currentTarget.value)}
        />
      </label>

      <label class="form-field">
        <span>Payer avec</span>
        <select
          class="select input-mono"
          value={assetSymbol()}
          onChange={(e) =>
            setAssetSymbol(e.currentTarget.value as BridgeDepositAssetSymbol)
          }
        >
          <For each={BRIDGE_DEPOSIT_CRYPTO_OPTIONS}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </label>

      <button
        type="button"
        class="btn btn-secondary btn-block"
        disabled={quoting() || loading()}
        onClick={() => void fetchQuote()}
      >
        {quoting() ? 'Calcul du devis...' : 'Calculer le devis'}
      </button>

      <Show when={error()}>
        <p class="form-error">{error()}</p>
      </Show>

      <Show when={quote()}>
        {(q) => (
          <div class="bridge-deposit-quote">
            <div class="bridge-deposit-row">
              <div class="bridge-deposit-row-info">
                <span class="bridge-deposit-label">A envoyer</span>
                <span class="text-mono">
                  {q().fromAmountFormatted} {q().asset.token.symbol} ({q().asset.chainName})
                </span>
              </div>
            </div>
            <div class="bridge-deposit-row">
              <div class="bridge-deposit-row-info">
                <span class="bridge-deposit-label">Estimation recue</span>
                <span class="text-mono">~{q().estOutputPusd.toFixed(2)} pUSD</span>
              </div>
            </div>
            <Show when={q().quoteApproximate}>
              <p class="form-hint">
                <Show when={q().warningBtcApproximate}>
                  <strong>⚠ Devis Bitcoin approximatif</strong> &mdash; le taux de conversion reel est determine par le bridge
                  au moment de la reception. Le montant final en pUSD peut varier.
                </Show>
                <Show when={!q().warningBtcApproximate}>
                  Montant BTC estime (devis API indisponible). Envoyez au moins ce montant ;
                  le bridge convertira en pUSD.
                </Show>
              </p>
            </Show>
            <div class="bridge-deposit-row">
              <div class="bridge-deposit-row-info">
                <span class="bridge-deposit-label">
                  Adresse bridge ({BRIDGE_ADDRESS_LABELS[q().bridgeAddressKind]})
                </span>
                <span class="text-mono bridge-deposit-address">{q().bridgeAddress}</span>
              </div>
            </div>

            <Show when={q().metamaskSupported && hasMetaMask()}>
              <button
                type="button"
                class="btn btn-primary btn-block"
                disabled={sending() || !!txHash()}
                onClick={() => void sendViaMetaMask()}
              >
                {sending()
                  ? 'Ouverture MetaMask...'
                  : txHash()
                    ? 'Transaction soumise'
                    : 'Envoyer via MetaMask'}
              </button>
            </Show>

            <Show when={q().metamaskSupported && !hasMetaMask()}>
              <p class="form-error">MetaMask requis pour envoyer {q().asset.token.symbol}.</p>
            </Show>

            <Show when={!q().metamaskSupported}>
              <p class="form-hint">
                {q().asset.token.symbol} ne passe pas par MetaMask. Copiez le montant et l'adresse,
                puis envoyez depuis votre wallet {q().asset.chainName}.
              </p>
              <button
                type="button"
                class="btn btn-primary btn-block"
                onClick={copyDepositInstructions}
              >
                {copyFeedback.isCopied(true) ? 'Copie !' : 'Copier montant et adresse'}
              </button>
            </Show>

            <Show when={txHash() && quote()}>
              <p class="form-hint">
                Tx source :{' '}
                <a
                  href={chainExplorerTxUrl(Number(quote()!.asset.chainId), txHash()!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-mono"
                >
                  {truncateAddress(txHash()!)}
                </a>
              </p>
            </Show>
          </div>
        )}
      </Show>

      <Show when={quote() && transactions().length === 0}>
        <p class="form-hint">Aucun depot detecte sur cette adresse pour l'instant.</p>
      </Show>

      <Show when={transactions().length > 0}>
        <span class="bridge-deposit-section-label">Suivi bridge</span>
        <div class="bridge-deposit-status">
          <For each={transactions()}>
            {(tx) => (
              <div
                class="bridge-deposit-status-row"
                classList={{
                  'bridge-deposit-status-done': tx.status === 'COMPLETED',
                  'bridge-deposit-status-failed': tx.status === 'FAILED',
                }}
              >
                <span>{bridgeStatusLabel(tx.status)}</span>
                <Show when={tx.txHash}>
                  <a
                    href={`https://polygonscan.com/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-mono"
                  >
                    {truncateAddress(tx.txHash!)}
                  </a>
                </Show>
                <Show when={!isBridgeStatusTerminal(tx.status)}>
                  <span class="form-hint">Actualisation auto…</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
