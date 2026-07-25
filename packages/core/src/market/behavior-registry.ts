import { MarketType } from './market-type.js';

/**
 * Comportements spécifiques à chaque type de marché.
 * Centralise toutes les décisions "quoi faire selon le type de marché".
 */
export interface MarketBehavior {
  /** Ce type de marché doit-il synchroniser son historique de prix ? */
  syncPriceHistory: boolean;
  /** Ce type de marché est-il éligible au trading algorithmique ? */
  algoTradingEligible: boolean;
  /** Ce type de marché utilise-t-il AlgoPriceTick plutôt que MarketPriceTick ? */
  useAlgoPriceTick: boolean;
  /** Ce type de marché est-il tracké par l'auto-track discovery ? */
  autoTrackEnabled: boolean;
  /** Intervalle de rafraîchissement recommandé pour le book WebSocket (ms) */
  bookRefreshIntervalMs: number;
}

/** Comportement de base pour tous les marchés crypto (sauf Up/Down court terme). */
const CRYPTO_BASE_BEHAVIOR: Omit<MarketBehavior, 'autoTrackEnabled'> = {
  syncPriceHistory: true,
  algoTradingEligible: true,
  useAlgoPriceTick: true,
  bookRefreshIntervalMs: 10_000,
};

const BEHAVIOR_REGISTRY: Record<MarketType, MarketBehavior> = {
  [MarketType.STANDARD]: {
    syncPriceHistory: true,
    algoTradingEligible: false,
    useAlgoPriceTick: false,
    autoTrackEnabled: false,
    bookRefreshIntervalMs: 60_000,
  },
  [MarketType.CRYPTO_UP_DOWN]: {
    // Seul CRYPTO_UP_DOWN a syncPriceHistory: false (marchés à court terme)
    syncPriceHistory: false,
    algoTradingEligible: true,
    useAlgoPriceTick: true,
    autoTrackEnabled: true,
    bookRefreshIntervalMs: 5_000,
  },
  [MarketType.CRYPTO_ABOVE_BELOW]: {
    ...CRYPTO_BASE_BEHAVIOR,
    autoTrackEnabled: true,
  },
  [MarketType.CRYPTO_TARGET_PRICE]: {
    ...CRYPTO_BASE_BEHAVIOR,
    autoTrackEnabled: true,
  },
  [MarketType.CRYPTO_PRICE_RANGE]: {
    ...CRYPTO_BASE_BEHAVIOR,
    autoTrackEnabled: true,
  },
  [MarketType.CRYPTO_OTHER]: {
    ...CRYPTO_BASE_BEHAVIOR,
    autoTrackEnabled: false,
  },
  [MarketType.WEATHER_TEMPERATURE]: {
    syncPriceHistory: true,
    algoTradingEligible: false,
    useAlgoPriceTick: false,
    autoTrackEnabled: false,
    bookRefreshIntervalMs: 60_000,
  },
  [MarketType.WEATHER_OTHER]: {
    syncPriceHistory: true,
    algoTradingEligible: false,
    useAlgoPriceTick: false,
    autoTrackEnabled: false,
    bookRefreshIntervalMs: 60_000,
  },
};

export function getMarketBehavior(marketType: MarketType): MarketBehavior {
  return BEHAVIOR_REGISTRY[marketType] ?? BEHAVIOR_REGISTRY[MarketType.STANDARD];
}

/**
 * Détermine si un marché doit synchroniser son historique de prix.
 */
export function shouldSyncPriceHistory(marketType: MarketType | null | undefined): boolean {
  const type = marketType ?? MarketType.STANDARD;
  return getMarketBehavior(type).syncPriceHistory;
}

/**
 * Vérifie si un marché est un marché crypto Up/Down à court terme.
 */
export function isCryptoUpDownMarket(marketType: MarketType | null | undefined): boolean {
  return marketType === MarketType.CRYPTO_UP_DOWN;
}
