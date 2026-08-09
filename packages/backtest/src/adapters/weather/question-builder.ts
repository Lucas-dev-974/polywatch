/**
 * Builds a canonical Polymarket-style weather question from a snapshot + tick,
 * so that parseWeatherQuestion (core) can re-parse it in the backtest adapter.
 *
 * The live strategy depends on parseWeatherQuestion to recover the bucket
 * comparison and bounds. When a tick carries a real `question`, we use it
 * verbatim; otherwise we synthesize one in the exact format the regexes expect.
 */

function formatDate(dateIso: string): string {
  // targetDateIso is like "2026-01-01". parseWeatherQuestion matches
  // "... on {date}?" with a greedy group — a bare ISO date parses fine.
  return dateIso;
}

export function buildWeatherQuestion(input: {
  question: string | null;
  city: string;
  targetDateIso: string;
  metric: string;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
}): string | null {
  if (input.question && input.question.trim()) {
    return input.question;
  }

  // parseWeatherQuestion (core) only understands highest_temp / lowest_temp.
  // Returning null for other metrics lets the adapter skip + warn instead of
  // silently mis-parsing a "highest temperature" question for precip/wind.
  if (input.metric !== 'highest_temp' && input.metric !== 'lowest_temp') {
    return null;
  }

  const metricWord = input.metric === 'lowest_temp' ? 'lowest' : 'highest';
  const date = formatDate(input.targetDateIso);
  const comparison = input.bucketComparison;

  if (comparison === 'between' && input.bucketLow != null && input.bucketHigh != null) {
    return `Will the ${metricWord} temperature in ${input.city} be between ${input.bucketLow}-${input.bucketHigh}°C on ${date}?`;
  }
  if (comparison === 'or_below' && input.bucketTarget != null) {
    return `Will the ${metricWord} temperature in ${input.city} be ${input.bucketTarget}°C or below on ${date}?`;
  }
  if (comparison === 'or_above' && input.bucketTarget != null) {
    return `Will the ${metricWord} temperature in ${input.city} be ${input.bucketTarget}°C or above on ${date}?`;
  }
  if (comparison === 'exact' && input.bucketTarget != null) {
    return `Will the ${metricWord} temperature in ${input.city} be ${input.bucketTarget}°C on ${date}?`;
  }

  // Unrecognized comparison/bounds — cannot synthesize a parseable question.
  return null;
}
