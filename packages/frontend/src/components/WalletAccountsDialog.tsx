import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { api } from '../api';
import { truncateAddress } from '../lib/address';
import { tryDeriveAddressFromPrivateKey } from '../lib/private-key';
import {
  SIGNATURE_TYPE_OPTIONS,
  type WalletAccountInput,
  type WalletAccountView,
} from '../lib/wallet';
import { Dialog } from './Dialog';
import { MetaMaskButton } from './MetaMaskButton';

interface WalletAccountsDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const emptyForm = (): WalletAccountInput => ({
  label: '',
  depositAddress: '',
  funderAddress: '',
  signerPrivateKey: '',
  signatureType: 3,
  isPrimary: false,
});

export function WalletAccountsDialog(props: WalletAccountsDialogProps) {
  const [accounts, setAccounts] = createSignal<WalletAccountView[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [formOpen, setFormOpen] = createSignal(false);
  const [form, setForm] = createSignal<WalletAccountInput>(emptyForm());
  const [error, setError] = createSignal<string | null>(null);

  const derivedSignerAddress = createMemo(() => {
    const pk = form().signerPrivateKey?.trim();
    if (!pk) return null;
    return tryDeriveAddressFromPrivateKey(pk);
  });

  const expectedFunder = createMemo(() => form().funderAddress?.trim().toLowerCase() || null);

  const signerKeyHint = createMemo(() => {
    const pk = form().signerPrivateKey?.trim();
    if (!pk) return null;
    const derived = derivedSignerAddress();
    if (!derived) {
      return {
        kind: 'error' as const,
        text: 'Cle invalide (64 caracteres hex attendus, pas la seed phrase).',
      };
    }
    const funder = expectedFunder();
    if (funder && derived !== funder) {
      return {
        kind: 'warning' as const,
        text: `Cette cle correspond a ${truncateAddress(derived)}, pas au funder ${truncateAddress(funder)}.`,
      };
    }
    return {
      kind: 'ok' as const,
      text: `Cle valide pour ${truncateAddress(derived)}.`,
    };
  });

  async function loadAccounts() {
    setLoading(true);
    try {
      const data = await api<{ accounts: WalletAccountView[] }>('/wallet/accounts');
      setAccounts(data.accounts);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    on(() => props.open, (open) => {
      if (open) {
        void loadAccounts();
      } else {
        setFormOpen(false);
        setEditingId(null);
        setForm(emptyForm());
        setError(null);
      }
    }),
  );

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm(), isPrimary: accounts().length === 0 });
    setError(null);
    setFormOpen(true);
  }

  function startEdit(account: WalletAccountView) {
    setEditingId(account.id);
    setFormOpen(true);
    setForm({
      label: account.label,
      depositAddress: account.depositAddress,
      funderAddress: account.eoaAddress ?? '',
      signerPrivateKey: '',
      signatureType: account.signatureType,
      isPrimary: account.isPrimary,
    });
    setError(null);
  }

  function updateField<K extends keyof WalletAccountInput>(key: K, value: WalletAccountInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = { ...form() };
      if (!body.signerPrivateKey) delete body.signerPrivateKey;

      if (editingId() != null) {
        await api(`/wallet/accounts/${editingId()}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        if (!body.signerPrivateKey && body.signatureType !== 3) {
          setError('Cle signer requise pour un nouveau wallet (sauf type 3 avec retrait MetaMask).');
          return;
        }
        await api('/wallet/accounts', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      await loadAccounts();
      props.onSaved();
      setEditingId(null);
      setFormOpen(false);
      setForm(emptyForm());
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('invalid_signer_private_key')) {
        setError(
          'Cle privee invalide. Exportez la cle depuis MetaMask (64 caracteres hex, pas la seed phrase).',
        );
      } else {
        setError(msg || 'Erreur lors de l enregistrement');
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('Supprimer ce wallet ?')) return;
    try {
      await api(`/wallet/accounts/${id}`, { method: 'DELETE' });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Échec de la suppression : ${err.message}`
          : 'Échec de la suppression.',
      );
      return;
    }
    await loadAccounts();
    props.onSaved();
    if (editingId() === id) {
      setEditingId(null);
      setFormOpen(false);
      setForm(emptyForm());
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Gerer les wallets"
      titleId="wallet-accounts-dialog-title"
      class="dialog-settings"
      bodyClass="dialog-body-settings"
    >
      <Show when={loading()}>
        <p class="form-hint">Chargement...</p>
      </Show>

      <Show when={!loading()}>
        <div class="wallet-accounts-list">
          <For each={accounts()}>
            {(account) => (
              <div class="wallet-account-row">
                <div class="wallet-account-row-info">
                  <span class="wallet-account-row-label">
                    {account.label}
                    <Show when={account.isPrimary}>
                      <span class="badge wallet-proxy-badge">Principal</span>
                    </Show>
                  </span>
                  <span class="wallet-address-meta text-mono">
                    {truncateAddress(account.depositAddress)}
                    {' · '}
                    {account.pUsdBalance.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}{' '}
                    pUSD
                  </span>
                </div>
                <div class="wallet-card-actions">
                  <button class="btn btn-ghost btn-sm" onClick={() => startEdit(account)}>
                    Modifier
                  </button>
                  <button class="btn btn-ghost btn-sm" onClick={() => void remove(account.id)}>
                    Supprimer
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>

        <Show when={!formOpen() && error()}>
          <p class="form-error">{error()}</p>
        </Show>

        <button class="btn btn-secondary btn-sm" style="margin-bottom: 1rem;" onClick={startCreate}>
          Ajouter un wallet
        </button>

        <Show when={formOpen()}>
          <div class="wallet-account-form">
            <label class="form-field">
              <span>Libelle</span>
              <input
                class="input"
                value={form().label}
                onInput={(e) => updateField('label', e.currentTarget.value)}
                placeholder="API, MetaMask..."
              />
            </label>

            <label class="form-field">
              <span>Adresse depot Polymarket</span>
              <input
                class="input input-mono"
                value={form().depositAddress}
                onInput={(e) => updateField('depositAddress', e.currentTarget.value)}
                placeholder="0x..."
              />
            </label>

            <label class="form-field">
              <span>EOA MetaMask (funder)</span>
              <div class="form-field-row">
                <input
                  class="input input-mono"
                  value={form().funderAddress ?? ''}
                  onInput={(e) => updateField('funderAddress', e.currentTarget.value)}
                  placeholder="0x..."
                />
                <MetaMaskButton
                  onConnected={(addr) => updateField('funderAddress', addr.toLowerCase())}
                />
              </div>
            </label>

            <label class="form-field">
              <span>Cle privee signer {editingId() != null ? '(laisser vide pour conserver)' : ''}</span>
              <span class="form-hint">
                Optionnel pour les wallets L2 (type 3) : le retrait se fait via popup MetaMask.
                Sinon, exportez la cle : compte → Details → Afficher la cle privee.
              </span>
              <input
                class="input input-mono"
                type="password"
                value={form().signerPrivateKey ?? ''}
                onInput={(e) => updateField('signerPrivateKey', e.currentTarget.value)}
                placeholder="0x... (coller apres export MetaMask)"
                autocomplete="off"
              />
              <Show when={signerKeyHint()}>
                {(hint) => (
                  <span
                    class="form-hint"
                    classList={{
                      'form-error': hint().kind === 'error',
                      'wallet-signer-warning': hint().kind === 'warning',
                      'wallet-signer-ok': hint().kind === 'ok',
                    }}
                  >
                    {hint().text}
                  </span>
                )}
              </Show>
            </label>

            <label class="form-field">
              <span>Type de signature</span>
              <select
                class="select"
                value={form().signatureType}
                onChange={(e) => updateField('signatureType', Number(e.currentTarget.value))}
              >
                <For each={SIGNATURE_TYPE_OPTIONS}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </label>

            <label class="form-field form-field-inline">
              <input
                type="checkbox"
                checked={form().isPrimary ?? false}
                onChange={(e) => updateField('isPrimary', e.currentTarget.checked)}
              />
              <span>Wallet principal (trading / worker)</span>
            </label>

            <Show when={error()}>
              <p class="form-error">{error()}</p>
            </Show>

            <button class="btn btn-primary btn-block" disabled={saving()} onClick={() => void save()}>
              {saving() ? 'Enregistrement...' : editingId() != null ? 'Mettre a jour' : 'Creer'}
            </button>
          </div>
        </Show>
      </Show>
    </Dialog>
  );
}
