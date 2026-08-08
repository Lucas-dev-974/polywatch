import type { DataSource } from 'typeorm';
import { binaryPricesFromParsed, binaryPricesToUpDown, type MarketListItemDto } from '@polywatch/core';

export interface ResolvedBucketPrices {
  yesPrice: number | null;
  noPrice: number | null;
  yesTokenId: string | null;
  noTokenId: string | null;
}

export function resolveBucketPrices(market: MarketListItemDto): ResolvedBucketPrices {
  const sidePrices = binaryPricesFromParsed(market.outcomePrices ?? []);
  const upDown = binaryPricesToUpDown(sidePrices);
  return {
    yesPrice: upDown.upPrice,
    noPrice: upDown.downPrice,
    yesTokenId: market.tokenIdYes,
    noTokenId: market.tokenIdNo,
  };
}
