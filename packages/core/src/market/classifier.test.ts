import { describe, expect, it } from 'vitest';
import { MarketClassifier, marketClassifier } from './classifier.js';
import { MarketType } from './market-type.js';

describe('MarketClassifier', () => {
  const classifier = new MarketClassifier();

  describe('classify()', () => {
    it('classifies standard market without crypto tags or symbols', () => {
      const result = classifier.classify({
        question: 'Will the Lakers win the championship?',
        category: 'Sports',
        tagSlugs: ['sports', 'nba'],
      });
      expect(result).toBe(MarketType.STANDARD);
    });

    it('classifies standard market with null question', () => {
      const result = classifier.classify({
        question: null,
        category: 'Politics',
        tagSlugs: [],
      });
      expect(result).toBe(MarketType.STANDARD);
    });

    it('classifies CRYPTO_UP_DOWN from question with known symbol', () => {
      const result = classifier.classify({
        question: 'Bitcoin Up or Down - June 25, 4:50AM-4:55AM',
        category: 'Crypto',
        tagSlugs: [],
      });
      expect(result).toBe(MarketType.CRYPTO_UP_DOWN);
    });

    it('classifies CRYPTO_UP_DOWN from crypto tags even without symbol in question', () => {
      const result = classifier.classify({
        question: 'Up or Down on the next move?',
        category: 'Crypto',
        tagSlugs: ['crypto', 'up-or-down'],
      });
      expect(result).toBe(MarketType.CRYPTO_UP_DOWN);
    });

    it('does NOT classify as CRYPTO_UP_DOWN when question has "Up or Down" but no crypto symbol or tag (§9.1)', () => {
      const result = classifier.classify({
        question: 'Stock market Up or Down today?',
        category: 'Finance',
        tagSlugs: ['finance'],
      });
      // §9.1: sans symbole crypto reconnu ni tag crypto, ce n'est PAS CRYPTO_UP_DOWN
      expect(result).toBe(MarketType.STANDARD);
    });

    it('classifies CRYPTO_ABOVE_BELOW from question with known symbol', () => {
      const result = classifier.classify({
        question: 'Ethereum above $4000 by end of month?',
        category: 'Crypto',
        tagSlugs: ['crypto'],
      });
      expect(result).toBe(MarketType.CRYPTO_ABOVE_BELOW);
    });

    it('classifies CRYPTO_TARGET_PRICE from question with known symbol', () => {
      const result = classifier.classify({
        question: 'What price will Bitcoin hit by December?',
        category: 'Crypto',
        tagSlugs: ['crypto'],
      });
      expect(result).toBe(MarketType.CRYPTO_TARGET_PRICE);
    });

    it('classifies CRYPTO_PRICE_RANGE from question with known symbol', () => {
      const result = classifier.classify({
        question: 'What price range will Solana hit between $100-$150?',
        category: 'Crypto',
        tagSlugs: ['crypto'],
      });
      expect(result).toBe(MarketType.CRYPTO_PRICE_RANGE);
    });

    it('classifies CRYPTO_OTHER for crypto question without known pattern', () => {
      const result = classifier.classify({
        question: 'Will Bitcoin be adopted by more countries?',
        category: 'Crypto',
        tagSlugs: ['crypto'],
      });
      expect(result).toBe(MarketType.CRYPTO_OTHER);
    });

    it('classifies CRYPTO_OTHER when question is null but has crypto tags', () => {
      const result = classifier.classify({
        question: null,
        category: 'Crypto',
        tagSlugs: ['crypto'],
      });
      expect(result).toBe(MarketType.CRYPTO_OTHER);
    });

    it('recognizes all known crypto symbols', () => {
      const symbols = [
        'Bitcoin', 'Ethereum', 'Solana', 'XRP', 'Dogecoin',
        'Cardano', 'Chainlink', 'Polygon', 'Litecoin', 'Polkadot',
        'Avalanche', 'Uniswap', 'Shiba Inu',
      ];
      for (const symbol of symbols) {
        const result = classifier.classify({
          question: `${symbol} Up or Down - 5 min window`,
          category: 'Crypto',
          tagSlugs: [],
        });
        expect(result).toBe(MarketType.CRYPTO_UP_DOWN);
      }
    });

    it('handles up/down variations (up/down, up-down)', () => {
      const result1 = classifier.classify({
        question: 'Ethereum up/down - 1h window',
        category: 'Crypto',
        tagSlugs: [],
      });
      expect(result1).toBe(MarketType.CRYPTO_UP_DOWN);

      const result2 = classifier.classify({
        question: 'Solana up-down - 4h window',
        category: 'Crypto',
        tagSlugs: [],
      });
      expect(result2).toBe(MarketType.CRYPTO_UP_DOWN);
    });
  });

  describe('classifyCryptoCategory()', () => {
    it('returns "up-down" for Up/Down questions', () => {
      expect(classifier.classifyCryptoCategory('Bitcoin Up or Down?')).toBe('up-down');
      expect(classifier.classifyCryptoCategory('Ethereum up/down?')).toBe('up-down');
      expect(classifier.classifyCryptoCategory('Solana up-down?')).toBe('up-down');
    });

    it('returns "above-below" for Above/Below questions', () => {
      expect(classifier.classifyCryptoCategory('Ethereum above $4000?')).toBe('above-below');
      expect(classifier.classifyCryptoCategory('Bitcoin below $30000?')).toBe('above-below');
    });

    it('returns "target-price" for target price questions', () => {
      expect(classifier.classifyCryptoCategory('What price will Bitcoin hit?')).toBe('target-price');
    });

    it('returns "price-range" for range questions', () => {
      expect(classifier.classifyCryptoCategory('What price range will Solana hit 100-150?')).toBe('price-range');
      expect(classifier.classifyCryptoCategory('Price range for Ethereum?')).toBe('price-range');
    });

    it('returns "other" for unrecognized crypto questions', () => {
      expect(classifier.classifyCryptoCategory('Will Bitcoin be adopted?')).toBe('other');
    });

    it('returns null for null question', () => {
      expect(classifier.classifyCryptoCategory(null)).toBeNull();
    });
  });

  describe('hasCryptoSymbol()', () => {
    it('returns true for known crypto symbols', () => {
      expect(classifier.hasCryptoSymbol('Bitcoin is going up')).toBe(true);
      expect(classifier.hasCryptoSymbol('Ethereum price')).toBe(true);
      expect(classifier.hasCryptoSymbol('Shiba Inu token')).toBe(true);
    });

    it('returns false for unknown symbols', () => {
      expect(classifier.hasCryptoSymbol('Apple stock')).toBe(false);
      expect(classifier.hasCryptoSymbol('Gold price')).toBe(false);
    });
  });

  describe('extractCryptoSymbol()', () => {
    it('extracts the correct symbol from a question', () => {
      expect(classifier.extractCryptoSymbol('Bitcoin Up or Down?')).toBe('Bitcoin');
      expect(classifier.extractCryptoSymbol('Ethereum above $4000?')).toBe('Ethereum');
      expect(classifier.extractCryptoSymbol('Shiba Inu price?')).toBe('Shiba Inu');
    });

    it('returns null for non-crypto questions', () => {
      expect(classifier.extractCryptoSymbol('Will it rain today?')).toBeNull();
    });

    it('returns null for null question', () => {
      expect(classifier.extractCryptoSymbol(null)).toBeNull();
    });
  });

  describe('singleton', () => {
    it('exports a pre-created instance', () => {
      expect(marketClassifier).toBeInstanceOf(MarketClassifier);
    });
  });
});
