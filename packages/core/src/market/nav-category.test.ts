import { describe, expect, it } from 'vitest';
import { resolveMarketNavCategorySlug } from './nav-category.js';

describe('resolveMarketNavCategorySlug', () => {
  it('maps weather nav slug directly', () => {
    expect(resolveMarketNavCategorySlug(['weather', 'recurring'])).toBe(
      'weather',
    );
  });

  it('maps daily temperature leaf tags to weather', () => {
    expect(
      resolveMarketNavCategorySlug([
        'recurring',
        'hide-from-new',
        'daily-temperature',
        'highest-temperature',
        'shanghai',
      ]),
    ).toBe('weather');
  });

  it('infers weather from the market question', () => {
    expect(
      resolveMarketNavCategorySlug(
        [],
        null,
        'Will the highest temperature in NYC be 70°F or higher?',
      ),
    ).toBe('weather');
  });

  it('does not classify temperature markets as crypto', () => {
    expect(
      resolveMarketNavCategorySlug(
        ['daily', 'today', 'hit-price', 'recurring'],
        null,
        'Will the highest temperature in London be 22°C or higher?',
      ),
    ).toBe('weather');
  });
});
