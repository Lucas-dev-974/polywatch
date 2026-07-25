import { MarketType } from './market-type.js';

/** Crypto symbols we want to recognize in market questions. Ordered by priority. */
export const CRYPTO_SYMBOLS = [
  'Bitcoin',
  'Ethereum',
  'Solana',
  'XRP',
  'Dogecoin',
  'Cardano',
  'Chainlink',
  'Polygon',
  'Litecoin',
  'Polkadot',
  'Avalanche',
  'Uniswap',
  'Shiba Inu',
] as const;

const CRYPTO_SYMBOL_PATTERN = new RegExp(
  `\\b(${CRYPTO_SYMBOLS.map((s) => s.replace(/\s/g, '\\s+')).join('|')})\\b`,
  'i',
);

/** Tag slugs that indicate a market is crypto-related. */
const CRYPTO_TAG_SLUGS = new Set(['crypto', 'up-or-down', 'crypto-prices']);

/**
 * Map of regex patterns to their corresponding crypto category string.
 * Source unique pour tous les patterns de classification — utilisé à la fois
 * par `classifyCryptoCategory()` et `classifyCryptoQuestion()`.
 */
const CRYPTO_CATEGORY_PATTERNS: { regex: RegExp; category: string; marketType: MarketType }[] = [
  { regex: /\b(up or down|up\/down|up-down)\b/i, category: 'up-down', marketType: MarketType.CRYPTO_UP_DOWN },
  { regex: /\b(above|below)\b/i, category: 'above-below', marketType: MarketType.CRYPTO_ABOVE_BELOW },
  { regex: /\bwhat price will\b/i, category: 'target-price', marketType: MarketType.CRYPTO_TARGET_PRICE },
  { regex: /(?:price|hit).*(?:\d+\s*[-–—]\s*\d+|range)|range/i, category: 'price-range', marketType: MarketType.CRYPTO_PRICE_RANGE },
];

/**
 * Classifieur centralisé de type de marché.
 * Point d'entrée unique pour déterminer le MarketType à partir des données Gamma.
 * Toute modification de la logique de classification se fait ici.
 */
export class MarketClassifier {
  /**
   * Détermine le type de marché à partir des métadonnées Gamma.
   * Appelé à chaque persistance (insertion ou update) — la classification reste fraîche
   * si la question change.
   * Le résultat est stocké dans la colonne `market_type`.
   */
  classify(raw: {
    question: string | null;
    category: string | null;
    tagSlugs: string[] | undefined;
  }): MarketType {
    if (this.hasCryptoTags(raw.tagSlugs)) {
      return this.classifyCryptoQuestion(raw.question);
    }

    if (raw.question && this.isUpDownQuestion(raw.question) && this.hasCryptoSymbol(raw.question)) {
      return MarketType.CRYPTO_UP_DOWN;
    }

    if (raw.question && this.hasCryptoSymbol(raw.question)) {
      return this.classifyCryptoQuestion(raw.question);
    }

    if (raw.question && this.isWeatherTemperatureQuestion(raw.question)) {
      return MarketType.WEATHER_TEMPERATURE;
    }

    return MarketType.STANDARD;
  }

  /** Check if the question matches the temperature market pattern. */
  private isWeatherTemperatureQuestion(question: string): boolean {
    return /\b(highest|lowest)\s+temperature\b/i.test(question);
  }

  /** Vérifie si la question contient un symbole crypto reconnu. */
  hasCryptoSymbol(question: string): boolean {
    return CRYPTO_SYMBOL_PATTERN.test(question);
  }

  /** Extrait le symbole crypto de la question, ou null si aucun n'est trouvé. */
  extractCryptoSymbol(question: string | null): string | null {
    if (!question) return null;
    const match = question.match(CRYPTO_SYMBOL_PATTERN);
    if (!match) return null;
    const found = match[1]!.toLowerCase();
    return CRYPTO_SYMBOLS.find((s) => s.toLowerCase() === found) ?? null;
  }

  /**
   * Détermine la catégorie crypto fonctionnelle (compatible avec l'ancien `cryptoCategory`).
   * Utilisé par le frontend pour le filtrage par sous-catégorie.
   */
  classifyCryptoCategory(question: string | null): string | null {
    if (!question) return null;
    for (const { regex, category } of CRYPTO_CATEGORY_PATTERNS) {
      if (regex.test(question)) return category;
    }
    return 'other';
  }

  private hasCryptoTags(tagSlugs: string[] | undefined): boolean {
    if (!tagSlugs) return false;
    return tagSlugs.some((slug) => CRYPTO_TAG_SLUGS.has(slug.toLowerCase()));
  }

  private isUpDownQuestion(question: string): boolean {
    return /^(?:[\w\s]+?)\s+(?:up or down|up\/down|up-down)\b/i.test(question);
  }

  private classifyCryptoQuestion(question: string | null): MarketType {
    if (!question) return MarketType.CRYPTO_OTHER;
    for (const { regex, marketType } of CRYPTO_CATEGORY_PATTERNS) {
      if (regex.test(question)) return marketType;
    }
    return MarketType.CRYPTO_OTHER;
  }
}

/** Instance singleton réutilisable du classifieur. */
export const marketClassifier = new MarketClassifier();
