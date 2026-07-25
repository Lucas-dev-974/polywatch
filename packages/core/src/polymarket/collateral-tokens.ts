import { POLYGON_CLOB_CONTRACTS_V2 } from './clob-contracts.js';
import {
  COLLATERAL_OFFRAMP_ADDRESS,
  COLLATERAL_ONRAMP_ADDRESS,
  PUSD_TOKEN_ADDRESS,
  USDC_E_ADDRESS,
} from './trading-wallet.js';

/** Native USDC on Polygon (Circle). */
export const USDC_NATIVE_ADDRESS =
  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

export type CollateralTokenSlug = 'USDC.e' | 'USDC' | 'pUSD';

export interface CollateralTokenDefinition {
  slug: CollateralTokenSlug;
  address: string;
}

export const COLLATERAL_TOKEN_DEFINITIONS: CollateralTokenDefinition[] = [
  { slug: 'USDC.e', address: USDC_E_ADDRESS },
  { slug: 'USDC', address: USDC_NATIVE_ADDRESS },
  { slug: 'pUSD', address: PUSD_TOKEN_ADDRESS },
];

export function collateralTokenSlugForAddress(
  contractAddress: string,
): CollateralTokenSlug | null {
  const normalized = contractAddress.toLowerCase();
  const match = COLLATERAL_TOKEN_DEFINITIONS.find(
    (token) => token.address.toLowerCase() === normalized,
  );
  return match?.slug ?? null;
}

/** Polymarket / CTF contracts — transfers to/from these are not wallet deposits. */
export function buildPolymarketInternalContracts(): Set<string> {
  const contracts = new Set<string>(
    [
      ...Object.values(POLYGON_CLOB_CONTRACTS_V2),
      COLLATERAL_ONRAMP_ADDRESS,
      COLLATERAL_OFFRAMP_ADDRESS,
    ].map((address) => address.toLowerCase()),
  );
  return contracts;
}

export function isPolymarketOnRamp(address: string): boolean {
  return address.toLowerCase() === COLLATERAL_ONRAMP_ADDRESS.toLowerCase();
}

export function isPolymarketOffRamp(address: string): boolean {
  return address.toLowerCase() === COLLATERAL_OFFRAMP_ADDRESS.toLowerCase();
}
