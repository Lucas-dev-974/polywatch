import {
  CLOB_SIGNATURE_POLY_1271,
  isDepositWalletSignatureType,
  resolveClobSignatureType,
} from './clob-signature.js';

export type LiveTradingBlockReason =
  | 'clob_credentials_not_found'
  | 'clob_credentials_incomplete'
  | 'invalid_signature_type'
  | 'no_deposit_address';

export interface LiveTradingReadinessInput {
  hasClobCredentials: boolean;
  hasApiKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
  hasSignerPk: boolean;
  signatureType: number | null | undefined;
  depositAddress: string | null | undefined;
}

export interface LiveTradingReadiness {
  liveReady: boolean;
  blockReason: LiveTradingBlockReason | null;
  signatureType: number | null;
  depositWalletSignatureType: number;
}

export function evaluateLiveTradingReadiness(
  input: LiveTradingReadinessInput,
): LiveTradingReadiness {
  const depositWalletSignatureType = CLOB_SIGNATURE_POLY_1271;
  const signatureType =
    input.signatureType != null
      ? resolveClobSignatureType(input.signatureType)
      : null;

  if (!input.hasClobCredentials) {
    return {
      liveReady: false,
      blockReason: 'clob_credentials_not_found',
      signatureType,
      depositWalletSignatureType,
    };
  }

  if (
    !input.hasApiKey ||
    !input.hasSecret ||
    !input.hasPassphrase ||
    !input.hasSignerPk
  ) {
    return {
      liveReady: false,
      blockReason: 'clob_credentials_incomplete',
      signatureType,
      depositWalletSignatureType,
    };
  }

  if (signatureType == null || !isDepositWalletSignatureType(signatureType)) {
    return {
      liveReady: false,
      blockReason: 'invalid_signature_type',
      signatureType,
      depositWalletSignatureType,
    };
  }

  if (!input.depositAddress) {
    return {
      liveReady: false,
      blockReason: 'no_deposit_address',
      signatureType,
      depositWalletSignatureType,
    };
  }

  return {
    liveReady: true,
    blockReason: null,
    signatureType,
    depositWalletSignatureType,
  };
}
