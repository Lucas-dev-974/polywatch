/**
 * Cumulative distribution function for the standard normal distribution.
 * Uses the Abramowitz-Stegun approximation for erf.
 */
export function normalCDF(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) {
    return x >= mean ? 1 : 0;
  }
  const z = (x - mean) / (stdDev * Math.SQRT2);
  // Abramowitz-Stegun approximation for erf
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return z >= 0 ? 0.5 + erf / 2 : 0.5 - erf / 2;
}

/**
 * Build a discrete probability distribution over integer temperature outcomes.
 * Each temperature k gets probability P(k-0.5 <= temp < k+0.5) = CDF(k+0.5) - CDF(k-0.5).
 *
 * @param forecastMean - Mean forecast temperature (°C)
 * @param forecastStdDev - Std dev of the forecast (°C)
 * @param outcomes - Array of integer temperature values to compute probabilities for
 * @returns Map of temperature -> probability [0,1]
 */
export function buildTempProbabilityDistribution(
  forecastMean: number,
  forecastStdDev: number,
  outcomes: number[],
): Map<number, number> {
  const dist = new Map<number, number>();
  for (const temp of outcomes) {
    const lower = normalCDF(temp - 0.5, forecastMean, forecastStdDev);
    const upper = normalCDF(temp + 0.5, forecastMean, forecastStdDev);
    dist.set(temp, Math.max(0, upper - lower));
  }
  return dist;
}

/**
 * Compute the cumulative probability P(temp <= target) for a normal forecast.
 * Used for markets asking "Will the highest/lowest temperature be X°C or below?".
 */
export function computeCdfBelow(
  target: number,
  forecastMean: number,
  forecastStdDev: number,
): number {
  // Convention de bin discrète (1 °C) : le bin du target couvre
  // [target - 0.5, target + 0.5). "Or below" = temp <= target, soit jusqu'à la
  // fin du bin du target. Symétrique de computeCdfAbove (qui soustrait 0.5).
  return normalCDF(target + 0.5, forecastMean, forecastStdDev);
}

/**
 * Compute the cumulative probability P(temp >= target) for a normal forecast.
 * Used for markets asking "Will the highest/lowest temperature be X°C or above?".
 */
export function computeCdfAbove(
  target: number,
  forecastMean: number,
  forecastStdDev: number,
): number {
  // P(temp >= target) = 1 - P(temp < target) = 1 - CDF(target - 0.5)
  // Uses -0.5 to align with the discrete bin convention: the bin for "target"
  // covers [target - 0.5, target + 0.5). "Or above" means >= target, so we
  // exclude everything strictly below target - 0.5.
  return 1 - normalCDF(target - 0.5, forecastMean, forecastStdDev);
}

/**
 * Build a forecast-implied probability for a weather market question.
 *
 * For "or_below" markets (e.g. "highest temp be X°C or below?"):
 *   YES price should equal P(temp <= X), NO price should equal P(temp > X).
 *
 * For "or_above" markets (e.g. "highest temp be X°C or above?"):
 *   YES price should equal P(temp >= X), NO price should equal P(temp < X).
 *
 * For "exact" markets, falls back to the discrete density at X.
 *
 * @returns Object with forecast-implied YES and NO probabilities.
 */
export function computeMarketImpliedProbabilities(
  target: number | null,
  comparison: 'exact' | 'or_below' | 'or_above' | 'between',
  forecastMean: number,
  forecastStdDev: number,
  targetLow?: number | null,
  targetHigh?: number | null,
): { yesProb: number; noProb: number } {
  if (comparison === 'between') {
    const low = targetLow ?? target ?? 0;
    const high = targetHigh ?? target ?? 0;
    const yesProb = Math.max(
      0,
      normalCDF(high + 0.5, forecastMean, forecastStdDev) -
        normalCDF(low - 0.5, forecastMean, forecastStdDev),
    );
    return { yesProb, noProb: 1 - yesProb };
  }
  if (comparison === 'or_below') {
    const yesProb = computeCdfBelow(target!, forecastMean, forecastStdDev);
    return { yesProb, noProb: 1 - yesProb };
  }
  if (comparison === 'or_above') {
    const yesProb = computeCdfAbove(target!, forecastMean, forecastStdDev);
    return { yesProb, noProb: 1 - yesProb };
  }
  // exact
  const yesProb = Math.max(
    0,
    normalCDF(target! + 0.5, forecastMean, forecastStdDev) -
      normalCDF(target! - 0.5, forecastMean, forecastStdDev),
  );
  return { yesProb, noProb: 1 - yesProb };
}