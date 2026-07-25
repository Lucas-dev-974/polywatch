import { amountPairs } from './clob-amounts.js';
import { clobOrderResponseSchema } from './clob-response-schema.js';

export { parseRawAmount } from './clob-amounts.js';

export interface ParsedFill {
  orderId: string;
  fillQuantity: number;
  actualFillPrice: number;
}

export type ParseFillOutcome =
  | { type: 'matched'; fill: ParsedFill }
  | { type: 'not_matched'; status: string }
  | { type: 'delayed'; status: string }
  | { type: 'invalid'; status: string; reason: string };

const FAILED_STATUSES = new Set(['FAILED', 'REJECTED']);

function isPlausiblePrice(price: number): boolean {
  return price > 0 && price <= 1;
}

function fillFromAmounts(
  signalSide: 'BUY' | 'SELL',
  making: number,
  taking: number,
  limitPrice: number,
): { fillQuantity: number; actualFillPrice: number; pricePlausible: boolean } | null {
  let fillQuantity: number;
  let actualFillPrice: number;

  if (signalSide === 'BUY') {
    fillQuantity = taking;
    actualFillPrice =
      fillQuantity > 0 && making > 0 ? making / fillQuantity : limitPrice;
  } else {
    fillQuantity = making;
    actualFillPrice =
      fillQuantity > 0 && taking > 0 ? taking / fillQuantity : limitPrice;
  }

  if (fillQuantity <= 0) return null;

  return {
    fillQuantity,
    actualFillPrice,
    pricePlausible: isPlausiblePrice(actualFillPrice),
  };
}

function scoreFillCandidate(
  fillQuantity: number,
  requestedQuantity: number,
): number {
  if (fillQuantity <= 0) return -Infinity;
  if (fillQuantity < requestedQuantity * 0.01) return -Infinity;

  let score = -Math.abs(fillQuantity - requestedQuantity);
  if (fillQuantity > requestedQuantity * 1.01) score -= 1_000;
  return score;
}

/**
 * Parse a CLOB POST /order response into fill quantity (shares) and price.
 *
 * Polymarket semantics:
 * - BUY: makingAmount = pUSD spent, takingAmount = shares received
 * - SELL: makingAmount = shares sold, takingAmount = pUSD received
 */
export function parseFillResponse(
  response: unknown,
  signalSide: 'BUY' | 'SELL',
  limitPrice: number,
  requestedQuantity: number,
): ParseFillOutcome {
  // Validate raw response shape with Zod schema
  const parsed = clobOrderResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      type: 'invalid',
      status: 'schema_mismatch',
      reason: `response_schema_mismatch: ${parsed.error.message}`,
    };
  }

  const r = parsed.data;
  const orderId = String(r.orderID ?? r.id ?? '');
  const status = String(r.status ?? '');
  const statusUpper = status.toUpperCase();
  const takingRaw = String(r.takingAmount ?? '0');
  const makingRaw = String(r.makingAmount ?? '0');

  if (statusUpper.includes('DELAY')) {
    return { type: 'delayed', status };
  }

  if (FAILED_STATUSES.has(statusUpper)) {
    return { type: 'not_matched', status };
  }

  let best: { fillQuantity: number; actualFillPrice: number } | null = null;
  let bestScore = -Infinity;
  let sawPositiveFillWithBadPrice = false;

  for (const { making, taking } of amountPairs(makingRaw, takingRaw)) {
    const candidate = fillFromAmounts(signalSide, making, taking, limitPrice);
    if (!candidate) continue;

    if (!candidate.pricePlausible) {
      if (candidate.fillQuantity > 0) sawPositiveFillWithBadPrice = true;
      continue;
    }

    const score = scoreFillCandidate(candidate.fillQuantity, requestedQuantity);
    if (score > bestScore) {
      bestScore = score;
      best = {
        fillQuantity: candidate.fillQuantity,
        actualFillPrice: candidate.actualFillPrice,
      };
    }
  }

  if (!best) {
    if (sawPositiveFillWithBadPrice) {
      return {
        type: 'invalid',
        status,
        reason: 'fill_parse_invalid_price',
      };
    }
    return { type: 'not_matched', status: status || 'zero_fill' };
  }

  if (best.fillQuantity > requestedQuantity * (signalSide === 'SELL' ? 1.01 : 1.2)) {
    return {
      type: 'invalid',
      status,
      reason: 'fill_parse_invalid_quantity',
    };
  }

  return {
    type: 'matched',
    fill: {
      orderId,
      fillQuantity: best.fillQuantity,
      actualFillPrice: best.actualFillPrice,
    },
  };
}
