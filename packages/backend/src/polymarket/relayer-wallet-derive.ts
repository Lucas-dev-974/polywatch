import { deriveProxyWallet, deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive.js';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config/index.js';
import { POLYGON_CHAIN_ID } from './polygon.js';

export type RelayerExecutionMode = 'proxy' | 'safe';

export function deriveRelayerExecutionWallet(
  signerAddress: string,
  mode: RelayerExecutionMode,
): string {
  const cfg = getContractConfig(POLYGON_CHAIN_ID);
  if (mode === 'safe') {
    return deriveSafe(signerAddress, cfg.SafeContracts.SafeFactory);
  }
  return deriveProxyWallet(signerAddress, cfg.ProxyContracts.ProxyFactory);
}
