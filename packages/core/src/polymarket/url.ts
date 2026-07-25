export function buildPolymarketMarketUrl(
  eventSlug: string | null | undefined,
  marketSlug: string | null | undefined,
  conditionId: string,
): string {
  // Parent event slug is the most stable Polymarket URL. Child market slugs
  // (e.g. "fifwc-fra-sen-2026-06-16-team-total-home-2pt5") often 404 at /event/{slug}.
  if (eventSlug) return `https://polymarket.com/event/${eventSlug}`;
  if (marketSlug) return `https://polymarket.com/event/${marketSlug}`;
  return `https://polymarket.com/market/${conditionId}`;
}
