import { CLOB_AMOUNT_DECIMALS } from '../constants.js';

/** Convert CLOB raw amount strings (6 decimal places) to human units. */
export function parseRawAmount(value: string): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw / 10 ** CLOB_AMOUNT_DECIMALS;
}

/** Human-readable vs raw 6-decimal interpretations of a CLOB amount string. */
export function amountInterpretations(value: string): number[] {
  const trimmed = value.trim();
  if (!trimmed) return [0];

  const asNumber = Number(trimmed);
  if (!Number.isFinite(asNumber) || asNumber < 0) return [0];

  if (trimmed.includes('.')) {
    return [asNumber];
  }

  const asRaw = asNumber / 10 ** CLOB_AMOUNT_DECIMALS;
  if (asRaw === asNumber) return [asNumber];
  return [asNumber, asRaw];
}

/** Pair making/taking at the same scale — never mix human with raw. */
export function amountPairs(
  makingRaw: string,
  takingRaw: string,
): Array<{ making: number; taking: number }> {
  const makingOpts = amountInterpretations(makingRaw);
  const takingOpts = amountInterpretations(takingRaw);
  const pairs: Array<{ making: number; taking: number }> = [
    { making: makingOpts[0]!, taking: takingOpts[0]! },
  ];

  if (makingOpts.length > 1 && takingOpts.length > 1) {
    pairs.push({ making: makingOpts[1]!, taking: takingOpts[1]! });
  }

  return pairs;
}

/**
 * Disambiguate a single CLOB amount (shares or collateral field).
 *
 * - Decimal strings are human-readable (`"2.5"`).
 * - Integers below 1_000_000 are human shares (raw would be sub-min size).
 * - Larger integers are raw 6-decimal units (`"2500000"` → 2.5).
 */
export function parseClobAmount(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const asNumber = Number(trimmed);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return 0;
  if (trimmed.includes('.')) return asNumber;
  if (asNumber < 1_000_000) return asNumber;
  return parseRawAmount(trimmed);
}
