export interface ParsedWeatherQuestion {
  city: string;
  metric: 'highest_temp' | 'lowest_temp';
  /** Target temperature in Celsius. Non-null for exact, or_below, or_above. Null for between. */
  targetValue: number | null;
  /** Low bound in Celsius. Only set for 'between' comparison. Null otherwise. */
  targetValueLow: number | null;
  /** High bound in Celsius. Only set for 'between' comparison. Null otherwise. */
  targetValueHigh: number | null;
  dateString: string;
  comparison: 'exact' | 'or_below' | 'or_above' | 'between';
  /** Original unit in the question. */
  unit: 'celsius' | 'fahrenheit';
}

/** Convert Fahrenheit to Celsius, rounded to 1 decimal. */
function fToC(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

// Regex for exact / or below / or above/higher patterns.
// Groups: 1=city, 2=value, 3=unit(C/F), 4=below/above/higher(optional), 5=date
const HIGHEST_TEMP_REGEX_OR =
  /highest temperature in (.+?) be (-?\d+)°([CF])(?: or (below|above|higher))? on (.+?)\?/i;
const LOWEST_TEMP_REGEX_OR =
  /lowest temperature in (.+?) be (-?\d+)°([CF])(?: or (below|above|higher))? on (.+?)\?/i;

// Regex for "between X-Y°" pattern.
// Groups: 1=city, 2=low value, 3=high value, 4=unit(C/F), 5=date
const HIGHEST_TEMP_REGEX_BETWEEN =
  /highest temperature in (.+?) be between (-?\d+)-(-?\d+)°([CF]) on (.+?)\?/i;
const LOWEST_TEMP_REGEX_BETWEEN =
  /lowest temperature in (.+?) be between (-?\d+)-(-?\d+)°([CF]) on (.+?)\?/i;

function buildOrResult(
  match: RegExpExecArray,
  metric: 'highest_temp' | 'lowest_temp',
): ParsedWeatherQuestion {
  const unit = match[3]!.toLowerCase() === 'f' ? 'fahrenheit' : 'celsius';
  const rawVal = parseInt(match[2]!, 10);
  const comparison: ParsedWeatherQuestion['comparison'] = match[4]
    ? (match[4].toLowerCase() === 'below' ? 'or_below' : 'or_above')
    : 'exact';
  return {
    city: match[1]!.trim(),
    metric,
    targetValue: unit === 'fahrenheit' ? fToC(rawVal) : rawVal,
    targetValueLow: null,
    targetValueHigh: null,
    dateString: match[5]!.trim(),
    comparison,
    unit,
  };
}

function buildBetweenResult(
  match: RegExpExecArray,
  metric: 'highest_temp' | 'lowest_temp',
): ParsedWeatherQuestion {
  const unit = match[4]!.toLowerCase() === 'f' ? 'fahrenheit' : 'celsius';
  const lowRaw = parseInt(match[2]!, 10);
  const highRaw = parseInt(match[3]!, 10);
  return {
    city: match[1]!.trim(),
    metric,
    targetValue: null,
    targetValueLow: unit === 'fahrenheit' ? fToC(lowRaw) : lowRaw,
    targetValueHigh: unit === 'fahrenheit' ? fToC(highRaw) : highRaw,
    dateString: match[5]!.trim(),
    comparison: 'between',
    unit,
  };
}

export function parseWeatherQuestion(
  question: string,
): ParsedWeatherQuestion | null {
  // Try "between" pattern first (more specific)
  const betweenHighest = HIGHEST_TEMP_REGEX_BETWEEN.exec(question);
  if (betweenHighest) return buildBetweenResult(betweenHighest, 'highest_temp');

  const betweenLowest = LOWEST_TEMP_REGEX_BETWEEN.exec(question);
  if (betweenLowest) return buildBetweenResult(betweenLowest, 'lowest_temp');

  // Try "exact / or below / or above" pattern
  const highestOr = HIGHEST_TEMP_REGEX_OR.exec(question);
  if (highestOr) return buildOrResult(highestOr, 'highest_temp');

  const lowestOr = LOWEST_TEMP_REGEX_OR.exec(question);
  if (lowestOr) return buildOrResult(lowestOr, 'lowest_temp');

  return null;
}

/**
 * Resolve a date string like "July 24" to a Date object in the current year.
 * This is used for display/logging only — the authoritative target date for
 * weather forecasts comes from the market's endDate field.
 */
export function resolveWeatherDate(dateString: string): Date {
  const year = new Date().getFullYear();
  // Parse as UTC noon. Prefer "Month D, YYYY 12:00:00 GMT" — Node rejects
  // the ISO-like form "July 24 2026T12:00:00Z" as Invalid Date.
  const parsedMs = Date.parse(`${dateString}, ${year} 12:00:00 GMT`);
  if (!Number.isNaN(parsedMs)) {
    return new Date(parsedMs);
  }
  const fallback = new Date(`${dateString} ${year}`);
  if (!Number.isNaN(fallback.getTime())) {
    // Normalize to noon UTC on the same calendar day in local interpretation.
    return new Date(
      Date.UTC(fallback.getFullYear(), fallback.getMonth(), fallback.getDate(), 12, 0, 0),
    );
  }
  return new Date();
}