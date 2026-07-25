export const PUSD_TOKEN_ADDRESS = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
export const PUSD_DECIMALS = 6;
export const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
export const COLLATERAL_ONRAMP_ADDRESS = '0x93070a847efEf7F70739046A929D47a521F5B8ee';
export const COLLATERAL_OFFRAMP_ADDRESS = '0x2957922Eb93258b93368531d39fAcCA3B4dC5854';

export interface ResolvedWalletAddresses {
  eoaAddress: string | null;
  depositAddress: string | null;
  proxyDetectionMethod: 'configured' | 'polyproxy' | 'eoa' | null;
}

/**
 * Resolves EOA vs Polymarket deposit addresses from CLOB credentials.
 * When funder differs from wallet, wallet is the deposit and funder is the EOA.
 */
export function resolveWalletAddresses(
  walletAddress: string | null,
  funderAddress: string | null,
  detectedProxy: string | null,
): ResolvedWalletAddresses {
  if (!walletAddress) {
    return { eoaAddress: null, depositAddress: null, proxyDetectionMethod: null };
  }

  const wallet = walletAddress.toLowerCase();
  const funder = funderAddress?.toLowerCase() ?? null;

  if (funder && funder !== wallet) {
    return {
      eoaAddress: funderAddress,
      depositAddress: walletAddress,
      proxyDetectionMethod: 'configured',
    };
  }

  if (detectedProxy && detectedProxy.toLowerCase() !== wallet) {
    return {
      eoaAddress: walletAddress,
      depositAddress: detectedProxy,
      proxyDetectionMethod: 'polyproxy',
    };
  }

  return {
    eoaAddress: walletAddress,
    depositAddress: walletAddress,
    proxyDetectionMethod: 'eoa',
  };
}

/** Deposit wallet used for pUSD collateral and ClobClient funder. */
export function resolveDepositAddress(
  walletAddress: string | null,
  funderAddress: string | null,
  detectedProxy: string | null,
): string | null {
  return resolveWalletAddresses(walletAddress, funderAddress, detectedProxy).depositAddress;
}
