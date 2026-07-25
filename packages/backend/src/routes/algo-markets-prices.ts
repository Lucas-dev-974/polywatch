import { Router } from 'express';
import type { DataSource } from 'typeorm';
import {
  AlgoAutoTrackService,
  binaryPricesFromParsed,
  binaryPricesToUpDown,
  createAlgoSelectionServices,
  extractStartDateFromQuestion,
  fetchGammaMarket,
  type GammaMarket,
  type MarketListItemDto,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged } from '../redis.js';
import { emitAlgoMarketsChanged } from '../websocket.js';

export type AlgoMarketPhase = 'live' | 'future';

export interface AlgoMarketPrice {
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  enabled: boolean;
  phase: AlgoMarketPhase;
  upPrice: number | null;
  downPrice: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  icon: string | null;
  startDate: string | null;
  endDate: string | null;
  resolved: boolean;
  closed: boolean;
}

export interface AlgoMarketsPricesResponse {
  live: AlgoMarketPrice[];
  future: AlgoMarketPrice[];
}

function gammaToPrices(gamma: GammaMarket | null): {
  upPrice: number | null;
  downPrice: number | null;
} {
  const resolved = binaryPricesFromParsed(gamma?.outcomePricesParsed ?? []);
  return binaryPricesToUpDown(resolved);
}

function buildLivePrice(
  sel: {
    conditionId: string;
    question: string | null;
    cryptoSymbol: string | null;
    interval: string | null;
    slug: string | null;
    enabled: boolean;
  },
  gamma: GammaMarket | null,
): AlgoMarketPrice {
  const { upPrice, downPrice } = gammaToPrices(gamma);
  return {
    conditionId: sel.conditionId,
    question: sel.question ?? gamma?.question ?? null,
    cryptoSymbol: sel.cryptoSymbol,
    interval: sel.interval,
    slug: sel.slug ?? gamma?.slug ?? null,
    enabled: sel.enabled,
    phase: 'live',
    upPrice,
    downPrice,
    volume24hr: gamma?.volume24hr ?? null,
    liquidityClob: gamma?.liquidityClob ?? null,
    icon: gamma?.icon ?? null,
    startDate:
      extractStartDateFromQuestion(sel.question ?? gamma?.question ?? null) ??
      null,
    endDate: gamma?.endDate ?? null,
    resolved: gamma?.resolved ?? false,
    closed: gamma?.closed ?? false,
  };
}

async function buildFuturePrice(
  market: MarketListItemDto,
): Promise<AlgoMarketPrice> {
  let gamma: GammaMarket | null = null;
  try {
    gamma = await fetchGammaMarket(market.conditionId);
  } catch {
    // Gamma fetch failed — use list metadata
  }

  const { upPrice, downPrice } = gammaToPrices(gamma);
  return {
    conditionId: market.conditionId,
    question: market.question ?? gamma?.question ?? null,
    cryptoSymbol: market.cryptoSymbol,
    interval: market.interval,
    slug: market.slug ?? gamma?.slug ?? null,
    enabled: false,
    phase: 'future',
    upPrice,
    downPrice,
    volume24hr: gamma?.volume24hr ?? market.volume24hr ?? null,
    liquidityClob: gamma?.liquidityClob ?? market.liquidityClob ?? null,
    icon: gamma?.icon ?? market.icon ?? null,
    startDate: market.startDate ?? extractStartDateFromQuestion(market.question),
    endDate: gamma?.endDate ?? market.endDate ?? null,
    resolved: gamma?.resolved ?? false,
    closed: gamma?.closed ?? false,
  };
}

async function notifyAlgoMarketsChangedIfNeeded(
  result: { disabled: number; added: number },
): Promise<void> {
  if (result.disabled > 0 || result.added > 0) {
    await publishConfigChanged();
    emitAlgoMarketsChanged();
  }
}

export function createAlgoMarketsPricesRouter(ds: DataSource): Router {
  const router = Router();
  const { selectionService } = createAlgoSelectionServices(ds);
  const autoTrackService = new AlgoAutoTrackService(ds);

  router.get('/', requireJwt, async (_req, res) => {
    const sync = await autoTrackService.syncMarketSelectionsIfNeeded(selectionService);
    if (sync.ran && (sync.disabled > 0 || sync.added > 0)) {
      AlgoAutoTrackService.invalidateFutureMarketsCache();
    }
    await notifyAlgoMarketsChangedIfNeeded(sync);

    const selections = await selectionService.loadAllEnabled();
    const live: AlgoMarketPrice[] = await Promise.all(
      selections.map(async (sel): Promise<AlgoMarketPrice> => {
        let gamma: GammaMarket | null = null;
        try {
          gamma = await fetchGammaMarket(sel.conditionId);
        } catch {
          // Gamma fetch failed — return basic info
        }
        return buildLivePrice(sel, gamma);
      }),
    );

    const liveConditionIdsByRule = new Map<string, string | null>();
    for (const sel of selections) {
      if (!sel.cryptoSymbol || !sel.interval) continue;
      liveConditionIdsByRule.set(
        `${sel.cryptoSymbol}:${sel.interval}`,
        sel.conditionId,
      );
    }

    const futureMarkets = await autoTrackService.discoverFutureMarketsForRulesThrottled(
      liveConditionIdsByRule,
      { force: sync.ran && (sync.disabled > 0 || sync.added > 0) },
    );

    /** Filter future markets to show only those starting within the next few minutes.
     * Polymarket often lists 5m markets ~2h ahead, but we want the imminent window only.
     * Show markets with startDate within [now, now+10min].
     */
    const future: AlgoMarketPrice[] = await Promise.all(
      futureMarkets.map((market) => buildFuturePrice(market)),
    );

    const filteredFuture = future.filter((m) => {
      if (!m.startDate) return false;
      const startMs = new Date(m.startDate).getTime();
      const delta = startMs - Date.now();
      // Start time must be within [0, 10min]
      return delta >= 0 && delta <= 10 * 60 * 1000;
    });

    const payload: AlgoMarketsPricesResponse = { live, future: filteredFuture };
    res.json(payload);
  });

  return router;
}
