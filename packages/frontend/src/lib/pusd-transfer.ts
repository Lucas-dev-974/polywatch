import {
  formatPusdAmount,
  normalizePusdAmountInput,
  parsePusdAmount,
} from '@polywatch/core/polymarket/pusd-amount';
import { PUSD_DECIMALS, PUSD_TOKEN_ADDRESS } from '@polywatch/core/polymarket/trading-wallet';
import { encodeErc20Transfer } from './erc20';
import { connectMetaMaskAccount, ensurePolygonNetwork } from './ethereum';

export { formatPusdAmount, normalizePusdAmountInput, parsePusdAmount, PUSD_DECIMALS, PUSD_TOKEN_ADDRESS };

export async function sendPusdViaMetaMask(
  from: string,
  to: string,
  amountRaw: bigint,
): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask non detecte');
  await ensurePolygonNetwork();
  return window.ethereum.request<string>({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: PUSD_TOKEN_ADDRESS,
        data: encodeErc20Transfer(to, amountRaw),
      },
    ],
  });
}

export async function depositPusdViaMetaMask(
  depositAddress: string,
  amountRaw: bigint,
): Promise<string> {
  const account = await connectMetaMaskAccount();
  return sendPusdViaMetaMask(account, depositAddress, amountRaw);
}

export async function withdrawPusdViaMetaMask(
  depositAddress: string,
  recipientAddress: string,
  amountRaw: bigint,
): Promise<string> {
  const account = await connectMetaMaskAccount();
  if (account !== depositAddress.toLowerCase()) {
    throw new Error('Connectez le wallet de depot');
  }
  return sendPusdViaMetaMask(account, recipientAddress, amountRaw);
}
