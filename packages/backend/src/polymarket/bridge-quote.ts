import { PUSD_DECIMALS, PUSD_TOKEN_ADDRESS } from '@polywatch/core';
import {
  type BridgeDepositAddresses,
  type BridgeQuoteResponse,
  type BridgeSupportedAsset,
  fetchBridgeQuote,
  fetchSupportedAssets,
  pickBridgeDepositAsset,
  type BridgeDepositAssetSymbol,
} from './bridge-client.js';

const POLYGON_CHAIN_ID = '137';
const PUSD_SCALE = 10n ** BigInt(PUSD_DECIMALS);

/** Rough USD prices for initial quote guess (not used for settlement). */
const ROUGH_USD_PER_TOKEN: Record<BridgeDepositAssetSymbol, number> = {
  BTC: 100_000,
  ETH: 3_500,
  POL: 0.08,
  SOL: 150,
};

/** Polymarket /quote does not return quotes for Bitcoin deposits. */
const QUOTE_UNSUPPORTED_SYMBOLS = new Set<BridgeDepositAssetSymbol>(['BTC']);

export interface BridgeDepositQuoteResult {
  asset: BridgeSupportedAsset;
  fromAmountBaseUnit: string;
  fromAmountFormatted: string;
  estOutputPusd: number;
  bridgeAddress: string;
  bridgeAddressKind: 'evm' | 'btc' | 'svm';
  metamaskSupported: boolean;
  quoteApproximate?: boolean;
  warningBtcApproximate?: boolean;
  quote: BridgeQuoteResponse;
}

function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = baseUnits / base;
  const frac = (baseUnits % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

function pusdFromBaseUnits(raw: bigint): number {
  return Number(raw) / Number(PUSD_SCALE);
}

function tokenScale(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function minFromBaseUnits(
  asset: BridgeSupportedAsset,
  symbol: BridgeDepositAssetSymbol,
): bigint {
  const scale = tokenScale(asset.token.decimals);
  const usdPerToken = ROUGH_USD_PER_TOKEN[symbol] ?? 1;
  const minTokens = asset.minCheckoutUsd / usdPerToken;
  const base = BigInt(Math.ceil(minTokens * Number(scale)));
  return base > 0n ? base : 1n;
}

function initialFromGuess(
  targetPusdRaw: bigint,
  asset: BridgeSupportedAsset,
  symbol: BridgeDepositAssetSymbol,
): bigint {
  const scale = tokenScale(asset.token.decimals);
  const targetUsd = Number(targetPusdRaw) / Number(PUSD_SCALE);
  const usdPerToken = ROUGH_USD_PER_TOKEN[symbol] ?? 1;
  const tokens = (targetUsd / usdPerToken) * 1.05;
  const minFrom = minFromBaseUnits(asset, symbol);
  const guess = BigInt(Math.ceil(tokens * Number(scale)));
  return guess > minFrom ? guess : minFrom;
}

async function requestBridgeQuote(
  params: {
    fromGuess: bigint;
    minFrom: bigint;
    asset: BridgeSupportedAsset;
    depositWallet: string;
  },
): Promise<BridgeQuoteResponse> {
  let attempt = params.fromGuess < params.minFrom ? params.minFrom : params.fromGuess;

  for (let retry = 0; retry < 5; retry++) {
    try {
      return await fetchBridgeQuote({
        fromAmountBaseUnit: attempt.toString(),
        fromChainId: params.asset.chainId,
        fromTokenAddress: params.asset.token.address,
        recipientAddress: params.depositWallet,
        toChainId: POLYGON_CHAIN_ID,
        toTokenAddress: PUSD_TOKEN_ADDRESS,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const tooSmall =
        msg.includes('bridge_http_500') || msg.includes('cannot get quote');
      if (tooSmall && attempt < params.minFrom * 32n) {
        attempt *= 2n;
        continue;
      }
      throw err;
    }
  }

  throw new Error('bridge_quote_failed');
}

function approximateBtcQuote(
  asset: BridgeSupportedAsset,
  pusdAmount: number,
  targetRaw: bigint,
  bridgeAddress: string,
): BridgeDepositQuoteResult {
  const scale = tokenScale(asset.token.decimals);
  const btcTokens = (pusdAmount / ROUGH_USD_PER_TOKEN.BTC) * 1.02;
  const fromGuess = BigInt(Math.max(Math.ceil(btcTokens * Number(scale)), Number(minFromBaseUnits(asset, 'BTC'))));

  return {
    asset,
    fromAmountBaseUnit: fromGuess.toString(),
    fromAmountFormatted: formatTokenAmount(fromGuess, asset.token.decimals),
    estOutputPusd: pusdAmount,
    bridgeAddress,
    bridgeAddressKind: 'btc',
    metamaskSupported: false,
    quoteApproximate: true,
    warningBtcApproximate: true,
    quote: { estToTokenBaseUnit: targetRaw.toString() },
  };
}

export async function quoteBridgeDepositForPusd(
  depositWallet: string,
  bridgeAddresses: BridgeDepositAddresses,
  assetSymbol: BridgeDepositAssetSymbol,
  pusdAmount: number,
): Promise<BridgeDepositQuoteResult> {
  const { supportedAssets } = await fetchSupportedAssets();
  const asset = pickBridgeDepositAsset(supportedAssets, assetSymbol);

  if (pusdAmount < asset.minCheckoutUsd) {
    throw new Error(`bridge_min_amount:${asset.minCheckoutUsd}`);
  }

  const bridgeAddressKind = assetSymbol === 'BTC' ? 'btc' : assetSymbol === 'SOL' ? 'svm' : 'evm';
  const bridgeAddress = bridgeAddresses[bridgeAddressKind];
  if (!bridgeAddress) throw new Error('bridge_address_missing');

  const targetRaw = BigInt(Math.round(pusdAmount * Number(PUSD_SCALE)));

  if (QUOTE_UNSUPPORTED_SYMBOLS.has(assetSymbol)) {
    return approximateBtcQuote(asset, pusdAmount, targetRaw, bridgeAddress);
  }

  const minFrom = minFromBaseUnits(asset, assetSymbol);
  let fromGuess = initialFromGuess(targetRaw, asset, assetSymbol);
  let quote!: BridgeQuoteResponse;

  for (let i = 0; i < 8; i++) {
    quote = await requestBridgeQuote({
      fromGuess,
      minFrom,
      asset,
      depositWallet,
    });

    const estOut = BigInt(quote.estToTokenBaseUnit || '0');
    if (estOut === 0n) break;

    if (estOut >= (targetRaw * 98n) / 100n && estOut <= (targetRaw * 102n) / 100n) {
      break;
    }

    const adjusted = (fromGuess * targetRaw) / estOut;
    fromGuess = adjusted > minFrom ? adjusted : minFrom;
  }

  return {
    asset,
    fromAmountBaseUnit: fromGuess.toString(),
    fromAmountFormatted: formatTokenAmount(fromGuess, asset.token.decimals),
    estOutputPusd: pusdFromBaseUnits(BigInt(quote!.estToTokenBaseUnit || '0')),
    bridgeAddress,
    bridgeAddressKind,
    metamaskSupported: assetSymbol === 'ETH' || assetSymbol === 'POL',
    quote: quote!,
  };
}

