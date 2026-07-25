import { createSignal, For, onMount, Show } from 'solid-js';
import { useClobCredentials } from '../hooks/useClobCredentials';
import { useCopyFeedback } from '../hooks/useCopyFeedback';
import { useCredsSetupDialog } from '../hooks/useCredsSetupDialog';
import { truncateAddress } from '../lib/address';
import {
  fetchWallet,
  primaryWalletAccount,
  type WalletAccountView,
  type WalletData,
} from '../lib/wallet';
import { ClobCredentialsDialog } from './ClobCredentialsDialog';
import { PusdTransferDialog, type PusdTransferMode } from './PusdTransferDialog';
import { WalletAccountsDialog } from './WalletAccountsDialog';
import { WalletHistorySection } from './WalletHistorySection';

export function WalletPage() {
  const [wallet, setWallet] = createSignal<WalletData | null>(null);
  const [loading, setLoading] = createSignal(true);
  const copyFeedback = useCopyFeedback<string>();
  const [transferOpen, setTransferOpen] = createSignal(false);
  const [transferMode, setTransferMode] = createSignal<PusdTransferMode>('deposit');
  const [transferAccount, setTransferAccount] = createSignal<WalletAccountView | null>(null);
  const [accountsDialogOpen, setAccountsDialogOpen] = createSignal(false);

  async function loadWallet() {
    try {
      setWallet(await fetchWallet());
    } catch {
      setWallet(null);
    }
  }

  const creds = useClobCredentials();
  const credsDialog = useCredsSetupDialog(creds, loadWallet);

  async function load() {
    setLoading(true);
    await Promise.all([loadWallet(), creds.refresh()]);
    setLoading(false);
  }

  onMount(() => {
    void load();
  });

  function handleCopy(address: string) {
    void copyFeedback.copy(address, address);
  }

  function openTransfer(mode: PusdTransferMode, account?: WalletAccountView) {
    const w = wallet();
    const target = account ?? (w ? primaryWalletAccount(w.accounts) : null);
    if (!target) return;
    setTransferAccount(target);
    setTransferMode(mode);
    setTransferOpen(true);
  }

  // wallet() is null while loading or after a failed fetch — never assume it.
  const w = () => wallet();
  const accounts = () => w()?.accounts ?? [];
  const hasWallets = () => accounts().length > 0 || !!w()?.depositAddress;

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="panel" style="padding: 2rem; text-align: center; color: var(--text-muted);">
          Chargement...
        </div>
      }
    >
      <section class="mode-hero" style="margin-bottom: 1rem;">
        <Show when={creds.needsSetup()}>
          <div class="alert alert-warning" style="margin-bottom: 1rem;">
            Configurez vos credentials CLOB pour activer le depot et le trading reel.
          </div>
        </Show>
        <Show when={creds.needsLiveSetup()}>
          <div class="alert alert-warning" style="margin-bottom: 1rem;">
            {creds.blockMessage() ??
              'Configuration live incomplète — vérifiez le wallet principal (signature type 3).'}
          </div>
        </Show>
        <Show when={!wallet() || creds.error()}>
          <div class="alert alert-warning" style="margin-bottom: 1rem;">
            Impossible de charger les donnees du portefeuille.{' '}
            <button class="btn btn-secondary btn-sm" onClick={() => void load()}>
              Reessayer
            </button>
          </div>
        </Show>
        <div class="mode-hero-group">
          <button class="btn btn-secondary btn-sm" onClick={() => credsDialog.setOpen(true)}>
            Configurer CLOB
          </button>
          <button class="btn btn-secondary btn-sm" onClick={() => setAccountsDialogOpen(true)}>
            Gerer les wallets
          </button>
        </div>
      </section>

      <ClobCredentialsDialog open={credsDialog.open()} onClose={credsDialog.close} />
      <WalletAccountsDialog
        open={accountsDialogOpen()}
        onClose={() => setAccountsDialogOpen(false)}
        onSaved={() => void loadWallet()}
      />

      <Show
        when={hasWallets()}
        fallback={
          <div class="panel" style="padding: 2rem; text-align: center;">
            <div class="empty-state">
              <div class="empty-state-icon">{'$'}</div>
              Aucun wallet configure. Enregistrez vos credentials CLOB ou ajoutez un wallet.
            </div>
          </div>
        }
      >
        <div class="wallet-total-bar">
          <span class="wallet-total-label">Solde total pUSD</span>
          <span class="wallet-balance-value">
            {(w()?.totalPUsdBalance ?? w()?.pUsdBalance ?? 0).toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
            <span class="wallet-balance-currency">pUSD</span>
          </span>
          <span class="wallet-balance-meta">
            {w()?.openPositionsCount ?? 0} position(s) ouverte(s)
            &middot; ~{(w()?.positionsValueUsdc ?? 0).toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            pUSD
          </span>
        </div>

        <div class="wallet-grid wallet-grid-accounts">
          <For each={accounts()}>
            {(account) => (
              <div class="wallet-card">
                <div class="wallet-card-header">
                  <span class="wallet-card-label">{account.label}</span>
                  <Show when={account.isPrimary}>
                    <span class="badge wallet-proxy-badge">Principal</span>
                  </Show>
                </div>

                <div class="wallet-address-row">
                  <div class="wallet-address-info">
                    <span class="wallet-address-label">
                      Depot Polymarket
                      <Show when={account.isL2Deposit}>
                        <span class="badge wallet-proxy-badge">L2</span>
                      </Show>
                    </span>
                    <span class="wallet-address">{truncateAddress(account.depositAddress)}</span>
                    <Show when={account.eoaAddress}>
                      <span class="wallet-address-meta">
                        Funder MetaMask : {truncateAddress(account.eoaAddress!)}
                      </span>
                    </Show>
                  </div>
                  <button
                    class="btn btn-ghost btn-sm"
                    onClick={() => handleCopy(account.depositAddress)}
                    title="Copier l'adresse du depot"
                  >
                    {copyFeedback.isCopied(account.depositAddress) ? 'Copie !' : 'Copier'}
                  </button>
                </div>

                <div class="wallet-balance-value" style="margin-top: 0.75rem;">
                  {account.pUsdBalance.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                  })}
                  <span class="wallet-balance-currency">pUSD</span>
                </div>

                <div class="wallet-card-actions">
                  <Show when={account.isPrimary}>
                    <button
                      class="btn btn-secondary btn-sm"
                      onClick={() => openTransfer('deposit', account)}
                    >
                      Verser
                    </button>
                  </Show>
                  <button
                    class="btn btn-secondary btn-sm"
                    onClick={() => openTransfer('withdraw', account)}
                  >
                    Retirer
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>

        <Show when={transferAccount() && wallet()}>
          <PusdTransferDialog
            open={transferOpen()}
            mode={transferMode()}
            wallet={wallet()!}
            account={transferAccount()!}
            onClose={() => setTransferOpen(false)}
            onSuccess={() => void loadWallet()}
          />
        </Show>

        <WalletHistorySection accounts={accounts()} />
      </Show>
    </Show>
  );
}
