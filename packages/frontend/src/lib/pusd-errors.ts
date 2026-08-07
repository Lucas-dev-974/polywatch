import type { DepositTab, WithdrawOutputAsset } from './wallet';

const SESSION_EXPIRED_MESSAGE =
  'Session expiree. Reconnectez-vous puis relancez le retrait.';

const PUSD_TRANSFER_ERRORS: Record<string, string> = {
  builder_not_configured:
    'Credentials Builder manquants. Configurez-les dans Configurer CLOB (onglet Reel).',
  signer_missing:
    'Cle signer CLOB manquante. Configurez vos credentials dans l\'onglet Reel.',
  invalid_signer_private_key:
    'Cle privee signer invalide pour ce wallet. Reexportez-la depuis MetaMask et mettez a jour le wallet.',
  insufficient_balance: 'Solde pUSD insuffisant sur le wallet de depot.',
  offramp_paused: 'Le unwrap Polymarket est temporairement en pause.',
  offramp_insufficient_liquidity:
    'Liquidite USDC.e insuffisante. Essayez un montant plus faible ou retirez en pUSD brut.',
  eoa_deposit_mismatch:
    'Le wallet de depot ne correspond pas au signer. Utilisez un wallet L2 avec credentials Builder.',
  deposit_signer_mismatch:
    'La cle signer ne controle pas ce depot Polymarket. Verifiez le signer associe a ce wallet.',
  deposit_relayer_wallet_mismatch:
    'Le depot Polymarket ne correspond pas au type de signature configure. Utilisez le type 3 (Proxy / Deposit Wallet) et verifiez l adresse depot et l EOA MetaMask.',
  relayer_tx_failed:
    'La transaction relayer a echoue. Verifiez vos credentials CLOB (signer, depot, type de signature).',
  relayer_tx_reverted:
    'La transaction relayer a ete minee mais a echoue on-chain. Verifiez le solde pUSD et le type de signature.',
  relayer_no_tx_hash:
    'Le relayer n a pas renvoye de hash de transaction. Reessayez.',
  relayer_http_error:
    'Le relayer Polymarket a refuse la transaction. Verifiez le signer et les credentials Builder.',
  relayer_deadline_too_soon: 'Delai de signature trop court. Relancez le retrait.',
  relayer_config_error: 'Configuration relayer invalide pour Polygon.',
  relayer_network_error: 'Impossible de joindre le relayer Polymarket.',
  withdraw_failed: 'Echec du retrait. Verifiez la configuration du wallet.',
  metamask_funder_required:
    'Configurez l EOA MetaMask (funder) dans Gerer les wallets avant de retirer.',
  metamask_account_mismatch:
    'Connectez le compte MetaMask qui controle ce wallet Polymarket.',
  metamask_sign_rejected: 'Signature MetaMask annulee.',
  withdraw_prepare_expired: 'Demande expiree. Relancez le retrait.',
  metamask_withdraw_unsupported_mode:
    'Retrait MetaMask non supporte pour ce type de signature.',
  bridge_error: 'Erreur du Bridge Polymarket. Reessayez plus tard.',
  bridge_min_amount: 'Montant inferieur au minimum requis pour ce bridge.',
  bridge_asset_unsupported: 'Actif non supporte par le Bridge Polymarket.',
  bridge_quote_missing: 'Calculez d\'abord le devis avant d\'envoyer.',
  withdraw_in_progress:
    'Un retrait identique est deja en cours d\'execution. Patientez quelques secondes puis rechargez.',
  'MetaMask non detecte': 'MetaMask requis pour cette operation.',
  invalid_token: SESSION_EXPIRED_MESSAGE,
  session_expired: SESSION_EXPIRED_MESSAGE,
};

export function mapPusdTransferError(message: string): string {
  if (message.startsWith('bridge_min_amount:')) {
    const min = message.split(':')[1];
    return `Montant minimum bridge : ~${min} USD.`;
  }
  if (message.startsWith('bridge_error:')) {
    return message.slice('bridge_error:'.length);
  }
  if (message.startsWith('bridge_http_500')) {
    return 'Devis bridge indisponible pour cette crypto. Essayez ETH ou POL, ou reessayez plus tard.';
  }
  if (message.startsWith('bridge_quote_failed')) {
    return 'Impossible d\'obtenir un devis precis. Reessayez ou choisissez une autre crypto.';
  }
  if (message.startsWith('bridge_asset_unsupported:')) {
    return PUSD_TRANSFER_ERRORS.bridge_asset_unsupported;
  }
  if (message === 'bridge_address_missing') {
    return 'Adresse bridge introuvable. Reessayez dans quelques instants.';
  }
  return PUSD_TRANSFER_ERRORS[message] ?? message;
}

export function pusdTransferHint(
  mode: 'deposit' | 'withdraw',
  isL2Deposit: boolean,
  outputAsset: WithdrawOutputAsset = 'usdc_e',
  depositTab: DepositTab = 'metamask',
): string {
  if (mode === 'deposit') {
    if (depositTab === 'bridge') {
      return 'Envoyez BTC, ETH, SOL ou d\'autres actifs vers l\'adresse bridge. Conversion automatique en pUSD sur votre wallet Polymarket.';
    }
    return 'Envoyez des pUSD depuis MetaMask vers votre wallet de trading Polymarket.';
  }

  if (outputAsset === 'usdc_e') {
    if (isL2Deposit) {
      return 'Unwrap gasless pUSD → USDC.e : une popup MetaMask demandera votre signature EIP-712.';
    }
    return 'Unwrap pUSD → USDC.e on-chain. Du POL est requis pour le gas MetaMask/signer.';
  }

  if (isL2Deposit) {
    return 'Retrait pUSD gasless : une popup MetaMask demandera votre signature EIP-712 (pas de cle privee stockee).';
  }
  return 'Retirez des pUSD vers votre EOA MetaMask ou une adresse externe.';
}
