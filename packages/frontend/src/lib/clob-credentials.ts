import { api } from '../api';
import {
  SIGNATURE_TYPE_DEPOSIT_WALLET,
  SIGNATURE_TYPE_OPTIONS as WALLET_SIGNATURE_TYPE_OPTIONS,
} from './wallet';

export type CredHintId =
  | 'wallet'
  | 'apiKey'
  | 'secret'
  | 'passphrase'
  | 'signerPk'
  | 'funder'
  | 'relayerUrl'
  | 'builderApiKey'
  | 'builderSecret'
  | 'builderPassphrase';

export interface ClobCredentialsForm {
  walletAddress: string;
  apiKey: string;
  secret: string;
  passphrase: string;
  signerPrivateKey: string;
  funderAddress: string;
  signatureType: string;
  relayerUrl: string;
  builderApiKey: string;
  builderSecret: string;
  builderPassphrase: string;
}

export type LiveTradingBlockReason =
  | 'clob_credentials_not_found'
  | 'clob_credentials_incomplete'
  | 'invalid_signature_type'
  | 'no_deposit_address'
  | 'clob_approvals_failed';

export interface ClobCredentialsStatus {
  configured: boolean;
  liveReady: boolean;
  blockReason: LiveTradingBlockReason | null;
  depositWalletSignatureType: number;
  walletAddress: string | null;
  funderAddress: string | null;
  signatureType: number | null;
  relayerUrl: string | null;
  hasApiKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
  hasSignerPk: boolean;
  hasBuilderApiKey: boolean;
  hasBuilderSecret: boolean;
  hasBuilderPassphrase: boolean;
}

type CredStatusKey = keyof Pick<
  ClobCredentialsStatus,
  | 'hasApiKey'
  | 'hasSecret'
  | 'hasPassphrase'
  | 'hasSignerPk'
  | 'hasBuilderApiKey'
  | 'hasBuilderSecret'
  | 'hasBuilderPassphrase'
>;

export interface ClobFieldConfig {
  key: keyof ClobCredentialsForm;
  label: string;
  placeholder: string;
  hintId: CredHintId;
  type?: 'text' | 'password';
  statusKey?: CredStatusKey;
}

export const L2_STATUS_KEYS = ['hasApiKey', 'hasSecret', 'hasPassphrase'] as const;
export const BUILDER_STATUS_KEYS = [
  'hasBuilderApiKey',
  'hasBuilderSecret',
  'hasBuilderPassphrase',
] as const;

export const SIGNATURE_TYPE_OPTIONS = WALLET_SIGNATURE_TYPE_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
}));

export const DEFAULT_SIGNATURE_TYPE = String(SIGNATURE_TYPE_DEPOSIT_WALLET);

export const DEFAULT_RELAYER_URL = 'https://relayer-v2.polymarket.com/';

export const CLOB_FORM_FIELDS: ClobFieldConfig[] = [
  { key: 'walletAddress', label: 'Depot Polymarket (L2)', placeholder: '0x... proxy / depot', hintId: 'wallet' },
  { key: 'apiKey', label: 'API Key L2', placeholder: 'Cle API Polymarket', hintId: 'apiKey', statusKey: 'hasApiKey' },
  { key: 'secret', label: 'Secret L2', placeholder: 'Secret fourni a la creation', hintId: 'secret', type: 'password', statusKey: 'hasSecret' },
  { key: 'passphrase', label: 'Passphrase L2', placeholder: 'Passphrase definie a la creation', hintId: 'passphrase', type: 'password', statusKey: 'hasPassphrase' },
  { key: 'signerPrivateKey', label: 'Signer private key', placeholder: 'Cle privee du wallet signer', hintId: 'signerPk', type: 'password', statusKey: 'hasSignerPk' },
  { key: 'funderAddress', label: 'EOA MetaMask (funder)', placeholder: '0x... wallet connecte', hintId: 'funder' },
];

export const BUILDER_FORM_FIELDS: ClobFieldConfig[] = [
  { key: 'relayerUrl', label: 'URL Relayer', placeholder: DEFAULT_RELAYER_URL, hintId: 'relayerUrl' },
  { key: 'builderApiKey', label: 'Builder API Key', placeholder: 'Cle API Builder Polymarket', hintId: 'builderApiKey', statusKey: 'hasBuilderApiKey' },
  { key: 'builderSecret', label: 'Builder Secret', placeholder: 'Secret Builder', hintId: 'builderSecret', type: 'password', statusKey: 'hasBuilderSecret' },
  { key: 'builderPassphrase', label: 'Builder Passphrase', placeholder: 'Passphrase Builder', hintId: 'builderPassphrase', type: 'password', statusKey: 'hasBuilderPassphrase' },
];

export function emptyClobCredentials(): ClobCredentialsForm {
  return {
    walletAddress: '',
    apiKey: '',
    secret: '',
    passphrase: '',
    signerPrivateKey: '',
    funderAddress: '',
    signatureType: DEFAULT_SIGNATURE_TYPE,
    relayerUrl: DEFAULT_RELAYER_URL,
    builderApiKey: '',
    builderSecret: '',
    builderPassphrase: '',
  };
}

export function credsFromStatus(status: ClobCredentialsStatus): ClobCredentialsForm {
  return {
    ...emptyClobCredentials(),
    walletAddress: status.walletAddress ?? '',
    funderAddress: status.funderAddress ?? '',
    signatureType:
      status.signatureType != null
        ? String(status.signatureType)
        : DEFAULT_SIGNATURE_TYPE,
    relayerUrl: status.relayerUrl ?? DEFAULT_RELAYER_URL,
  };
}

export function countSavedFields(
  status: ClobCredentialsStatus | null,
  keys: readonly CredStatusKey[],
): number {
  if (!status) return 0;
  return keys.filter((key) => status[key]).length;
}

export function countL2FieldsSaved(status: ClobCredentialsStatus | null): number {
  return countSavedFields(status, L2_STATUS_KEYS);
}

export function countBuilderFieldsSaved(status: ClobCredentialsStatus | null): number {
  return countSavedFields(status, BUILDER_STATUS_KEYS);
}

export function isCredFieldSaved(
  status: ClobCredentialsStatus | null,
  statusKey?: CredStatusKey,
): boolean | undefined {
  if (!status || !statusKey) return undefined;
  return status[statusKey];
}

export function liveTradingBlockMessage(
  reason: LiveTradingBlockReason | null | undefined,
): string | null {
  if (!reason) return null;
  const messages: Record<LiveTradingBlockReason, string> = {
    clob_credentials_not_found:
      'Configurez les credentials CLOB dans l’onglet Portefeuille.',
    clob_credentials_incomplete:
      'Credentials CLOB incomplets (API key, secret, passphrase ou signer manquant).',
    invalid_signature_type:
      'Le wallet principal doit utiliser le type de signature 3 — Deposit wallet (API). Vérifiez Portefeuille → Gérer les wallets.',
    no_deposit_address:
      'Adresse de dépôt Polymarket introuvable. Vérifiez le wallet principal.',
    clob_approvals_failed:
      'Approbations CLOB en échec. Réessayez depuis Portefeuille ou redémarrez le worker.',
  };
  return messages[reason];
}

export function fetchClobCredentialsStatus(): Promise<ClobCredentialsStatus> {
  return api<ClobCredentialsStatus>('/clob-credentials/status');
}

export function saveClobCredentials(creds: ClobCredentialsForm): Promise<void> {
  const signatureType = Number(creds.signatureType);
  return api('/clob-credentials', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress: creds.walletAddress,
      apiKey: creds.apiKey || undefined,
      secret: creds.secret || undefined,
      passphrase: creds.passphrase || undefined,
      signerPrivateKey: creds.signerPrivateKey || undefined,
      funderAddress: creds.funderAddress || undefined,
      signatureType: Number.isFinite(signatureType) ? signatureType : undefined,
      relayerUrl: creds.relayerUrl || undefined,
      builderApiKey: creds.builderApiKey || undefined,
      builderSecret: creds.builderSecret || undefined,
      builderPassphrase: creds.builderPassphrase || undefined,
    }),
  });
}
