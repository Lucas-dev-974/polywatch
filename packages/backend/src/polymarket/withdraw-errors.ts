import type { Response } from 'express';
import { BuilderNotConfiguredError } from './relayer-client.js';

export interface WithdrawErrorResponse {
  status: number;
  body: { error: string; message?: string };
}

export function sendWithdrawErrorResponse(res: Response, err: unknown): boolean {
  const mapped = mapWithdrawError(err);
  if (!mapped) return false;
  res.status(mapped.status).json(mapped.body);
  return true;
}

export function mapWithdrawError(err: unknown): WithdrawErrorResponse | null {
  if (err instanceof BuilderNotConfiguredError) {
    return {
      status: 400,
      body: {
        error: 'builder_not_configured',
        message:
          'Credentials Builder manquants. Configurez-les dans Configurer CLOB (onglet Reel).',
      },
    };
  }

  if (!(err instanceof Error)) return null;

  switch (err.message) {
    case 'signer_missing':
      return { status: 400, body: { error: 'signer_missing' } };
    case 'metamask_funder_required':
      return {
        status: 400,
        body: {
          error: 'metamask_funder_required',
          message:
            'EOA MetaMask (funder) requis pour signer le retrait. Configurez-le dans Gerer les wallets.',
        },
      };
    case 'metamask_withdraw_unsupported_mode':
      return {
        status: 400,
        body: {
          error: 'metamask_withdraw_unsupported_mode',
          message:
            'Ce type de wallet necessite encore une cle signer serveur. Utilisez un Deposit Wallet (type 3).',
        },
      };
    case 'relayer_deadline_too_soon':
      return {
        status: 400,
        body: {
          error: 'relayer_deadline_too_soon',
          message:
            'Delai de signature trop court pour le relayer. Relancez le retrait.',
        },
      };
    case 'withdraw_prepare_expired':
      return {
        status: 400,
        body: {
          error: 'withdraw_prepare_expired',
          message: 'La demande de retrait a expire. Relancez le retrait.',
        },
      };
    case 'metamask_account_mismatch':
      return {
        status: 400,
        body: {
          error: 'metamask_account_mismatch',
          message:
            'Le compte MetaMask connecte ne correspond pas au funder de ce wallet.',
        },
      };
    case 'invalid_signer_private_key':
      return {
        status: 400,
        body: {
          error: 'invalid_signer_private_key',
          message:
            'Cle privee signer invalide pour ce wallet. Reexportez-la depuis MetaMask (Account details > Show private key) et mettez a jour le wallet.',
        },
      };
    case 'insufficient_balance':
      return { status: 400, body: { error: 'insufficient_balance' } };
    case 'offramp_paused':
      return {
        status: 400,
        body: {
          error: 'offramp_paused',
          message: 'Le CollateralOfframp Polymarket est temporairement en pause.',
        },
      };
    case 'offramp_insufficient_liquidity':
      return {
        status: 400,
        body: {
          error: 'offramp_insufficient_liquidity',
          message:
            'Liquidite USDC.e insuffisante dans l offramp. Essayez un montant plus faible ou retirez en pUSD.',
        },
      };
    case 'eoa_deposit_mismatch':
      return {
        status: 400,
        body: {
          error: 'eoa_deposit_mismatch',
          message:
            'Le wallet de depot ne correspond pas au signer EOA. Utilisez un wallet L2 avec credentials Builder.',
        },
      };
    case 'deposit_signer_mismatch':
      return {
        status: 400,
        body: {
          error: 'deposit_signer_mismatch',
          message:
            'La cle signer ne controle pas ce depot Polymarket. Verifiez le signer associe a ce wallet.',
        },
      };
    case 'deposit_relayer_wallet_mismatch':
      return {
        status: 400,
        body: {
          error: 'deposit_relayer_wallet_mismatch',
          message:
            'Le depot configure ne correspond pas au wallet execute par le relayer pour ce type de signature. Verifiez le type de signature (Safe vs Proxy) et l adresse depot Polymarket.',
        },
      };
    case 'relayer_tx_failed':
    case 'relayer_tx_reverted':
    case 'relayer_no_tx_hash':
      return {
        status: 502,
        body: {
          error: err.message,
          message:
            'La transaction relayer a echoue on-chain. Verifiez le type de signature, le depot Polymarket et le signer.',
        },
      };
    case 'relayer_config_error':
      return {
        status: 502,
        body: {
          error: 'relayer_config_error',
          message: 'Configuration relayer invalide pour Polygon.',
        },
      };
    case 'relayer_network_error':
      return {
        status: 502,
        body: {
          error: 'relayer_network_error',
          message: 'Impossible de joindre le relayer Polymarket. Reessayez plus tard.',
        },
      };
    case 'relayer_unknown_error':
      return {
        status: 502,
        body: {
          error: 'relayer_unknown_error',
          message: 'Erreur inattendue du relayer Polymarket.',
        },
      };
    case 'transfer_reverted':
      return {
        status: 502,
        body: {
          error: 'transfer_reverted',
          message:
            'Le transfert pUSD on-chain a echoue (revert). Verifiez le solde et reessayez.',
        },
      };
    case 'approve_reverted':
      return {
        status: 502,
        body: {
          error: 'approve_reverted',
          message:
            'L approbation ERC20 on-chain a echoue (revert). Verifiez le solde POL pour le gas.',
        },
      };
    case 'offramp_reverted':
      return {
        status: 502,
        body: {
          error: 'offramp_reverted',
          message:
            'Le unwrap pUSD -> USDC.e on-chain a echoue. L offramp est peut-etre en pause ou la liquidite est insuffisante.',
        },
      };
    default: {
      const lower = err.message.toLowerCase();
      if (lower.includes('invalid private key') || lower.includes('invalid_signer_private_key')) {
        return {
          status: 400,
          body: {
            error: 'invalid_signer_private_key',
            message:
              'Cle privee signer invalide pour ce wallet. Reexportez-la depuis MetaMask et mettez a jour le wallet dans Gerer les wallets.',
          },
        };
      }
      if (err.message.startsWith('unsupported_signature_type')) {
        return { status: 400, body: { error: err.message } };
      }
      if (err.message.startsWith('relayer_http_')) {
        const detail = err.message.split(':').slice(1).join(':').trim();
        return {
          status: 502,
          body: {
            error: 'relayer_http_error',
            message:
              detail ||
              'Le relayer Polymarket a refuse la transaction. Verifiez le signer, le type de signature et les credentials Builder.',
          },
        };
      }
      return null;
    }
  }
}
