import { describe, expect, it } from 'vitest';
import { shouldPollMarketForLifecycle } from '../market/lifecycle.js';
import { needsGammaRefreshForResolve } from './market.service.js';

describe('needsGammaRefreshForResolve', () => {
  it('refreshes when no stored market exists', () => {
    expect(needsGammaRefreshForResolve(undefined)).toBe(true);
  });

  it('refreshes when display metadata is missing', () => {
    expect(
      needsGammaRefreshForResolve({
        question: null,
        slug: null,
        resolved: false,
        endDate: new Date('2099-01-01'),
      }),
    ).toBe(true);
  });

  it('skips refresh for settled markets with persisted metadata', () => {
    expect(
      needsGammaRefreshForResolve({
        question: 'Will BTC go up?',
        slug: 'btc-up',
        resolved: true,
        endDate: new Date('2020-01-01'),
      }),
    ).toBe(false);
  });

  it('refreshes unresolved markets near end date', () => {
    expect(
      needsGammaRefreshForResolve({
        question: 'Will BTC go up?',
        slug: 'btc-up',
        resolved: false,
        endDate: new Date(Date.now() + 30_000),
      }),
    ).toBe(true);
  });
});

describe('shouldPollMarketForLifecycle', () => {
  it('polls when no stored market exists', () => {
    expect(shouldPollMarketForLifecycle(undefined)).toBe(true);
  });

  it('polls when the market is already resolved', () => {
    expect(
      shouldPollMarketForLifecycle({
        resolved: true,
        endDate: new Date('2099-01-01'),
      }),
    ).toBe(true);
  });

  it('polls when end date is unknown', () => {
    expect(
      shouldPollMarketForLifecycle({
        resolved: false,
        endDate: null,
      }),
    ).toBe(true);
  });

  it('polls when end date has passed', () => {
    expect(
      shouldPollMarketForLifecycle({
        resolved: false,
        endDate: new Date(Date.now() - 60_000),
      }),
    ).toBe(true);
  });

  it('polls during pre-close window before end date', () => {
    expect(
      shouldPollMarketForLifecycle(
        {
          resolved: false,
          endDate: new Date(Date.now() + 30_000),
        },
        60,
      ),
    ).toBe(true);
  });

  it('skips polling well before end date', () => {
    expect(
      shouldPollMarketForLifecycle({
        resolved: false,
        endDate: new Date(Date.now() + 86_400_000),
      }),
    ).toBe(false);
  });
});
