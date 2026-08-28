export const POLYGON_CHAIN_ID = 137;
export const POLYGON_CHAIN_HEX = '0x89';
export const ETHEREUM_CHAIN_ID = 1;

const KNOWN_CHAINS: Record<
  number,
  { chainName: string; symbol: string; rpcUrls: string[]; blockExplorerUrls: string[] }
> = {
  [ETHEREUM_CHAIN_ID]: {
    chainName: 'Ethereum Mainnet',
    symbol: 'ETH',
    rpcUrls: ['https://ethereum.publicnode.com'],
    blockExplorerUrls: ['https://etherscan.io'],
  },
  [POLYGON_CHAIN_ID]: {
    chainName: 'Polygon Mainnet',
    symbol: 'POL',
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
  },
};

export interface EthereumProvider {
  isMetaMask?: boolean;
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function hasMetaMask(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum?.isMetaMask;
}

export async function connectMetaMaskAccount(): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask non detecte');
  const accounts = await window.ethereum.request<string[]>({
    method: 'eth_requestAccounts',
  });
  if (!accounts.length) throw new Error('Aucun compte MetaMask');
  return accounts[0].toLowerCase();
}

/**
 * Ensures the selected MetaMask account is `expectedAddress`.
 * On mismatch, opens the MetaMask account picker once, then retries.
 */
export async function connectMatchingMetaMaskAccount(
  expectedAddress: string,
): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask non detecte');
  await ensurePolygonNetwork();

  const expected = expectedAddress.toLowerCase();
  let selected = await connectMetaMaskAccount();
  if (selected === expected) return selected;

  try {
    await window.ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      throw new Error('metamask_sign_rejected');
    }
    throw err;
  }

  selected = await connectMetaMaskAccount();
  if (selected === expected) return selected;

  throw new Error(`metamask_account_mismatch:${expected}:${selected}`);
}

export async function ensurePolygonNetwork(): Promise<void> {
  await ensureEthereumChain(POLYGON_CHAIN_ID);
}

export async function ensureEthereumChain(chainId: number): Promise<void> {
  if (!window.ethereum) throw new Error('MetaMask non detecte');
  const chainHex = `0x${chainId.toString(16)}`;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 4902) throw err;
    const meta = KNOWN_CHAINS[chainId];
    if (!meta) throw err;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainHex,
          chainName: meta.chainName,
          nativeCurrency: { name: meta.symbol, symbol: meta.symbol, decimals: 18 },
          rpcUrls: meta.rpcUrls,
          blockExplorerUrls: meta.blockExplorerUrls,
        },
      ],
    });
  }
}
