/**
 * Binary outcome token helpers — side0/side1 slots with dynamic Gamma labels.
 * side0 maps to tokenIdYes / upPrice / signal YES; side1 to tokenIdNo / downPrice / NO.
 */

export const SIDE0_ALIAS_LABELS = ['yes', 'up'] as const;
export const SIDE1_ALIAS_LABELS = ['no', 'down'] as const;

export type MarketOutcomeSide = 0 | 1;

export interface MarketOutcomeToken {
  label: string;
  tokenId: string;
  side: MarketOutcomeSide;
}

export interface OutcomePricePair {
  outcome: string;
  price: number;
}

export interface OutcomeSideLabels {
  side0: string;
  side1: string;
}

export interface BinaryOutcomePrices {
  side0: OutcomePricePair | null;
  side1: OutcomePricePair | null;
}

function isSide0Label(label: string): boolean {
  return SIDE0_ALIAS_LABELS.includes(
    label.toLowerCase() as (typeof SIDE0_ALIAS_LABELS)[number],
  );
}

function isSide1Label(label: string): boolean {
  return SIDE1_ALIAS_LABELS.includes(
    label.toLowerCase() as (typeof SIDE1_ALIAS_LABELS)[number],
  );
}

/** Resolve side0/side1 prices from parsed Gamma outcomes (alias match or index fallback). */
export function binaryPricesFromParsed(
  prices: OutcomePricePair[],
): BinaryOutcomePrices {
  const side0ByAlias = prices.find((p) => isSide0Label(p.outcome)) ?? null;
  const side1ByAlias = prices.find((p) => isSide1Label(p.outcome)) ?? null;

  if (side0ByAlias && side1ByAlias) {
    return { side0: side0ByAlias, side1: side1ByAlias };
  }

  if (prices.length === 2) {
    return { side0: prices[0]!, side1: prices[1]! };
  }

  return { side0: null, side1: null };
}

/** Map side0/side1 prices to up/down slot names used by price feeds and ticks. */
export function binaryPricesToUpDown(prices: BinaryOutcomePrices): {
  upPrice: number | null;
  downPrice: number | null;
} {
  return {
    upPrice: prices.side0?.price ?? null,
    downPrice: prices.side1?.price ?? null,
  };
}

/** Map outcome/token pairs to binary CLOB slots (alias match or pure index when incomplete). */
export function mapBinaryTokenSlots(
  pairs: { outcome: string; tokenId: string }[],
): { tokenIdYes: string | null; tokenIdNo: string | null } {
  if (pairs.length !== 2) {
    return { tokenIdYes: null, tokenIdNo: null };
  }

  const side0ByAlias = pairs.find((p) => isSide0Label(p.outcome)) ?? null;
  const side1ByAlias = pairs.find((p) => isSide1Label(p.outcome)) ?? null;

  if (side0ByAlias && side1ByAlias) {
    return {
      tokenIdYes: side0ByAlias.tokenId,
      tokenIdNo: side1ByAlias.tokenId,
    };
  }

  return {
    tokenIdYes: pairs[0]!.tokenId,
    tokenIdNo: pairs[1]!.tokenId,
  };
}

/** Build outcome tokens with labels matched by tokenId against resolved slots. */
export function outcomesFromPairsWithSlots(
  pairs: { outcome: string; tokenId: string }[],
  tokenIdYes: string | null,
  tokenIdNo: string | null,
): MarketOutcomeToken[] {
  if (!tokenIdYes || !tokenIdNo) return [];

  const tokens: MarketOutcomeToken[] = [];
  for (const side of [0, 1] as const) {
    const tokenId = side === 0 ? tokenIdYes : tokenIdNo;
    const pair = pairs.find((p) => p.tokenId === tokenId);
    tokens.push({
      label: pair?.outcome ?? (side === 0 ? 'Yes' : 'No'),
      tokenId,
      side,
    });
  }
  return tokens;
}

/** Preserve slot assignment when Gamma returns the same token pair in permuted order. */
export function mergeStableBinaryTokenSlots(
  existing: { tokenIdYes: string | null; tokenIdNo: string | null },
  fetched: { tokenIdYes: string | null; tokenIdNo: string | null },
): { tokenIdYes: string | null; tokenIdNo: string | null } {
  const { tokenIdYes: existingYes, tokenIdNo: existingNo } = existing;
  const { tokenIdYes: fetchedYes, tokenIdNo: fetchedNo } = fetched;

  if (!existingYes || !existingNo || !fetchedYes || !fetchedNo) {
    return { tokenIdYes: fetchedYes, tokenIdNo: fetchedNo };
  }

  const samePair =
    (existingYes === fetchedYes && existingNo === fetchedNo) ||
    (existingYes === fetchedNo && existingNo === fetchedYes);
  if (!samePair) {
    return { tokenIdYes: fetchedYes, tokenIdNo: fetchedNo };
  }

  return { tokenIdYes: existingYes, tokenIdNo: existingNo };
}

export function parseMarketOutcomes(raw: string | null | undefined): MarketOutcomeToken[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): MarketOutcomeToken[] => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as Record<string, unknown>;
      const label = typeof record.label === 'string' ? record.label : null;
      const tokenId = typeof record.tokenId === 'string' ? record.tokenId : null;
      const side = record.side === 0 || record.side === 1 ? record.side : null;
      if (!label || !tokenId || side == null) return [];
      return [{ label, tokenId, side }];
    });
  } catch {
    return [];
  }
}

export function serializeMarketOutcomes(outcomes: MarketOutcomeToken[]): string {
  return JSON.stringify(outcomes);
}

export function labelForSide(
  outcomes: MarketOutcomeToken[],
  side: MarketOutcomeSide,
): string | null {
  return outcomes.find((o) => o.side === side)?.label ?? null;
}

export function labelForTokenId(
  outcomes: MarketOutcomeToken[],
  tokenId: string | null | undefined,
): string | null {
  if (!tokenId) return null;
  const normalized = tokenId.toLowerCase();
  return outcomes.find((o) => o.tokenId.toLowerCase() === normalized)?.label ?? null;
}

export function sideForTokenId(
  outcomes: MarketOutcomeToken[],
  tokenId: string | null | undefined,
): MarketOutcomeSide | null {
  if (!tokenId) return null;
  const normalized = tokenId.toLowerCase();
  return outcomes.find((o) => o.tokenId.toLowerCase() === normalized)?.side ?? null;
}

export function displayLabelForAssetId(
  outcomes: MarketOutcomeToken[],
  assetId: string | null | undefined,
  fallback?: string | null,
): string | null {
  return labelForTokenId(outcomes, assetId) ?? fallback ?? null;
}

export function toOutcomeSideLabels(
  outcomes: MarketOutcomeToken[],
): OutcomeSideLabels | null {
  const side0 = labelForSide(outcomes, 0);
  const side1 = labelForSide(outcomes, 1);
  if (!side0 || !side1) return null;
  return { side0, side1 };
}
