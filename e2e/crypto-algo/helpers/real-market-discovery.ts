import type { DataSource } from 'typeorm';
import {
  AlgoMarketSelection,
  MarketService,
  fetchGammaMarketsByTagSlug,
  type MarketListItemDto,
} from '@polywatch/core';

export interface DiscoveredMarket {
  conditionId: string;
  tokenIdYes: string;
  tokenIdNo: string;
  question: string;
  cryptoSymbol: string;
  interval: string;
}

/**
 * Gamma tag slugs that carry crypto "Up or Down" interval markets, ordered
 * from shortest to longest interval. We try them in order and pick the first
 * active market found.
 */
const UP_DOWN_TAGS = ['5M', '15M', '1H', '4H'];

/**
 * Discover an active crypto Up/Down market from the Gamma API at runtime,
 * persist it to the test database, and create an enabled AlgoMarketSelection
 * so the StrategyRunner picks it up.
 *
 * Tries short intervals first (5m, 15m, 1h, 4h) and falls back to longer ones
 * if no active market is found for the shorter interval. Returns the
 * conditionId + token ids the test needs to subscribe and watch. Throws if no
 * eligible market is found across all tags and retries.
 */
export async function discoverActiveCrypto5mMarket(
  ds: DataSource,
  maxAttempts = 3,
): Promise<DiscoveredMarket> {
  const marketService = new MarketService(ds);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const tagSlug of UP_DOWN_TAGS) {
      const result = await fetchGammaMarketsByTagSlug({
        tagSlug,
        active: true,
        closed: false,
        limit: 50,
      });

      const eligible = result.items.find((item) => isEligibleUpDownMarket(item));

      if (eligible) {
        // Persist the market row (fetches full Gamma market data + token ids).
        await marketService.ensureTradableMarket(eligible.conditionId);

        const interval = eligible.interval ?? tagSlug.toLowerCase();

        // Create the algo selection so the StrategyRunner evaluates it.
        const selectionRepo = ds.getRepository(AlgoMarketSelection);
        const existing = await selectionRepo.findOne({
          where: { conditionId: eligible.conditionId },
        });
        if (!existing) {
          await selectionRepo.save(
            selectionRepo.create({
              conditionId: eligible.conditionId,
              question: eligible.question ?? null,
              cryptoSymbol: eligible.cryptoSymbol ?? 'Bitcoin',
              interval,
              slug: eligible.slug ?? null,
              enabled: true,
            }),
          );
        } else {
          existing.enabled = true;
          existing.interval = interval;
          await selectionRepo.save(existing);
        }

        return {
          conditionId: eligible.conditionId,
          tokenIdYes: eligible.tokenIdYes!,
          tokenIdNo: eligible.tokenIdNo!,
          question: eligible.question ?? '',
          cryptoSymbol: eligible.cryptoSymbol ?? 'Bitcoin',
          interval,
        };
      }
    }

    if (attempt < maxAttempts - 1) {
      console.warn(
        `[real-sim] no active Up/Down market found, retrying in 15s (attempt ${attempt + 1}/${maxAttempts})`,
      );
      await sleep(15_000);
    }
  }

  throw new Error(
    'discoverActiveCrypto5mMarket: no active crypto Up/Down market found after retries',
  );
}

function isEligibleUpDownMarket(item: MarketListItemDto): boolean {
  if (!item.tokenIdYes || !item.tokenIdNo) return false;
  if (item.closed) return false;

  // acceptingOrders may be null on Gamma — treat null as accepting.
  if (item.acceptingOrders === false) return false;

  // Must be a crypto Up/Down market.
  const isUpDown =
    item.cryptoCategory === 'up-down' ||
    /\bup or down\b/i.test(item.question ?? '');
  if (!isUpDown) return false;

  // Must have a short interval (5m, 15m, 1h, 4h).
  const interval = item.interval;
  if (!interval || !/^(5m|15m|1h|4h)$/i.test(interval)) return false;

  // Must end in the future (at least 2 minutes from now so the test has time).
  if (item.endDate) {
    const end = new Date(item.endDate).getTime();
    if (end <= Date.now() + 120_000) return false;
  } else {
    // No endDate is suspicious for an interval market — skip.
    return false;
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}