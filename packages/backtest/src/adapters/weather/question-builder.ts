/**
 * Builds a canonical Polymarket-style weather question from a snapshot + tick,
 * so that parseWeatherQuestion (core) can re-parse it in the backtest adapter.
 *
 * The live strategy depends on parseWeatherQuestion to recover the bucket
 * comparison and bounds. When a tick carries a real `question`, we use it
 * verbatim; otherwise we synthesize one in the exact format the regexes expect.
 */

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
  const date = input.targetDateIso;
  const comparison = input.bucketComparison;

  // parseWeatherQuestion only accepts integer °C (`-?\d+`). Round non-integers
  // so synthesized questions remain parseable.
  const intTarget =
    input.bucketTarget != null ? Math.round(input.bucketTarget) : null;
  const intLow = input.bucketLow != null ? Math.round(input.bucketLow) : null;
  const intHigh = input.bucketHigh != null ? Math.round(input.bucketHigh) : null;

  if (comparison === 'between' && intLow != null && intHigh != null) {
    return `Will the ${metricWord} temperature in ${input.city} be between ${intLow}-${intHigh}°C on ${date}?`;
  }
  if (comparison === 'or_below' && intTarget != null) {
    return `Will the ${metricWord} temperature in ${input.city} be ${intTarget}°C or below on ${date}?`;
  }
  if (comparison === 'or_above' && intTarget != null) {
    return `Will the ${metricWord} temperature in ${input.city} be ${intTarget}°C or above on ${date}?`;
  }
  if (comparison === 'exact' && intTarget != null) {
    return `Will the ${metricWord} temperature in ${input.city} be ${intTarget}°C on ${date}?`;
  }

  // Unrecognized comparison/bounds — cannot synthesize a parseable question.
  return null;
}
