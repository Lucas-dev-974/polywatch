import { BrowserProvider } from 'ethers';
import { api } from '../api';
import { connectMatchingMetaMaskAccount, connectMetaMaskAccount, ensurePolygonNetwork } from './ethereum';
import {
  depositWalletBatchMessage,
  type DepositWalletTypedDataV4,
} from './deposit-wallet-signing';
import type { WalletAccountView, WithdrawOutputAsset } from './wallet';
import { formatPusdAmount } from './pusd-transfer';

export interface WithdrawPrepareResponse {
  prepareId: string;
  signMethod: 'typed_data_v4';
  signerAddress: string;
  typedData: DepositWalletTypedDataV4;
}

export interface WithdrawSubmitResponse {
  txHash: string;
}

async function signDepositWalletTypedData(
  signerAddress: string,
  typedData: DepositWalletTypedDataV4,
): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask non detecte');
  await connectMatchingMetaMaskAccount(signerAddress);

  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner(signerAddress);

  try {
    return await signer.signTypedData(
      typedData.domain,
      typedData.types,
      depositWalletBatchMessage(typedData),
    );
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      throw new Error('metamask_sign_rejected');
    }
    throw err;
  }
}

export async function withdrawL2ViaMetaMask(
  account: WalletAccountView,
  amountRaw: bigint,
  recipient: string,
  outputAsset: WithdrawOutputAsset,
): Promise<string> {
  const prepare = await api<WithdrawPrepareResponse>('/wallet/pusd/withdraw/prepare', {
    method: 'POST',
    body: JSON.stringify({
      amount: formatPusdAmount(amountRaw),
      recipient,
      outputAsset,
      walletAccountId: account.id,
    }),
  });

  const signature = await signDepositWalletTypedData(
    prepare.signerAddress,
    prepare.typedData,
  );

  const submitted = await api<WithdrawSubmitResponse>('/wallet/pusd/withdraw/submit', {
    method: 'POST',
    body: JSON.stringify({
      prepareId: prepare.prepareId,
      signature,
      signerAddress: prepare.signerAddress,
    }),
  });

  return submitted.txHash;
}

export async function wrapL2ViaMetaMask(
  account: WalletAccountView,
  amountRaw: bigint,
  recipient: string,
): Promise<string> {
  await ensurePolygonNetwork();
  const connected = await connectMetaMaskAccount();

  const prepare = await api<WithdrawPrepareResponse>('/wallet/usdce/wrap/prepare', {
    method: 'POST',
    body: JSON.stringify({
      amount: formatPusdAmount(amountRaw),
      recipient,
      walletAccountId: account.id,
      signerAddress: connected,
    }),
  });

  const signature = await signDepositWalletTypedData(
    prepare.signerAddress,
    prepare.typedData,
  );

  const submitted = await api<WithdrawSubmitResponse>('/wallet/usdce/wrap/submit', {
    method: 'POST',
    body: JSON.stringify({
      prepareId: prepare.prepareId,
      signature,
      signerAddress: prepare.signerAddress,
    }),
  });

  return submitted.txHash;
}
