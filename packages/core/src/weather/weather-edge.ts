/**
 * Calculate the edge = forecast probability - market price.
 * Positive edge means the market underprices the outcome (buy YES).
 * Negative edge means the market overprices the outcome (buy NO or skip).
 */
export function calculateEdge(
  forecastProbability: number,
  marketPrice: number,
): number {
  return forecastProbability - marketPrice;
}

/**
 * Resolve the dynamic minimum edge threshold based on:
 * - Forecast uncertainty (std dev across models): higher uncertainty → higher edge required
 * - Time to resolution: closer to resolution → lower edge required (forecast is more reliable)
 *
 * Formula: max(5%, base_edge + uncertainty_penalty + time_factor)
 *
 * @param forecastStdDev - Std dev across weather models (°C)
 * @param hoursToResolution - Hours remaining before market resolves
 * @param baseEdge - Base edge from RiskConfig (default 0.10)
 */
export function resolveDynamicMinEdge(
  forecastStdDev: number,
  hoursToResolution: number,
  baseEdge: number = 0.10,
): number {
  // Uncertainty penalty: +5% per °C of std dev, capped at +15%
  const uncertaintyPenalty = Math.min(forecastStdDev * 0.05, 0.15);

  // Time factor: -3% if ≤6h to resolution (forecast reliable), 0% if ≤24h, +5% if >24h
  let timeFactor: number;
  if (hoursToResolution <= 6) {
    timeFactor = -0.03;
  } else if (hoursToResolution <= 24) {
    timeFactor = 0;
  } else {
    timeFactor = 0.05;
  }

  return Math.max(0.05, baseEdge + uncertaintyPenalty + timeFactor);
}