import { encodeErc20Transfer } from './erc20';
import {
  connectMetaMaskAccount,
  ensureEthereumChain,
  hasMetaMask,
} from './ethereum';

const NATIVE_TOKEN_SENTINELS = new Set([
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0x0000000000000000000000000000000000000000',
]);

export function chainExplorerTxUrl(chainId: number, txHash: string): string {
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  return `https://polygonscan.com/tx/${txHash}`;
}

export function isNativeBridgeToken(tokenAddress: string): boolean {
  return NATIVE_TOKEN_SENTINELS.has(tokenAddress.toLowerCase());
}

export async function sendBridgeDepositViaMetaMask(params: {
  chainId: number;
  bridgeAddress: string;
  tokenAddress: string;
  fromAmountBaseUnit: string;
}): Promise<string> {
  if (!hasMetaMask() || !window.ethereum) {
    throw new Error('MetaMask non detecte');
  }

  const account = await connectMetaMaskAccount();
  await ensureEthereumChain(params.chainId);

  const amountRaw = BigInt(params.fromAmountBaseUnit);

  if (isNativeBridgeToken(params.tokenAddress)) {
    return window.ethereum.request<string>({
      method: 'eth_sendTransaction',
      params: [
        {
          from: account,
          to: params.bridgeAddress,
          value: `0x${amountRaw.toString(16)}`,
        },
      ],
    });
  }

  return window.ethereum.request<string>({
    method: 'eth_sendTransaction',
    params: [
      {
        from: account,
        to: params.tokenAddress,
        data: encodeErc20Transfer(params.bridgeAddress, amountRaw),
      },
    ],
  });
}
