import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeDataSource } from '../database/data-source.js';
import { createTestDataSource } from '../database/test-data-source.js';
import { seedDefaults } from '../seed/defaults.js';
import { MarketService } from './market.service.js';
import { AlgoMarketSelectionService } from './algo-market-selection.service.js';

describe('AlgoMarketSelectionService', () => {
  let ds: Awaited<ReturnType<typeof initializeDataSource>>;
  let marketService: MarketService;
  let service: AlgoMarketSelectionService;

  beforeEach(async () => {
    ds = await initializeDataSource(createTestDataSource());
    await seedDefaults(ds);
    marketService = new MarketService(ds);
    service = new AlgoMarketSelectionService(ds, marketService);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('addSelection calls ensureTradableMarket via ensureMarketPersisted', async () => {
    const ensureSpy = vi
      .spyOn(marketService, 'ensureTradableMarket')
      .mockResolvedValue({ conditionId: 'c1', tokenIdYes: 'yes' } as never);

    await service.addSelection('c1', {
      cryptoSymbol: 'Bitcoin',
      interval: '5m',
      question: 'Bitcoin Up or Down',
    });

    expect(ensureSpy).toHaveBeenCalledWith('c1');
  });

  it('setEnabled(true) persists market metadata', async () => {
    await service.addSelection('c1', {
      cryptoSymbol: 'Bitcoin',
      interval: '5m',
    });
    const ensureSpy = vi.spyOn(marketService, 'ensureTradableMarket');
    ensureSpy.mockClear();

    await service.setEnabled('c1', false);
    await service.setEnabled('c1', true);

    expect(ensureSpy).toHaveBeenCalledWith('c1');
  });

  it('ensureMarketPersisted returns stored market when token ids exist', async () => {
    const market = {
      conditionId: 'c1',
      tokenIdYes: 'yes-token',
      tokenIdNo: 'no-token',
    } as never;
    vi.spyOn(marketService, 'ensureTradableMarket').mockResolvedValue(market);

    const result = await service.ensureMarketPersisted('c1');
    expect(result?.tokenIdYes).toBe('yes-token');
  });

  it('getStatusCounts reports tradable selections', async () => {
    await service.addSelection('c1', { cryptoSymbol: 'Bitcoin', interval: '5m' });
    await service.addSelection('c2', { cryptoSymbol: 'Ethereum', interval: '5m' });

    vi.spyOn(marketService, 'loadByConditionIds').mockResolvedValue(
      new Map([
        [
          'c1',
          {
            conditionId: 'c1',
            tokenIdYes: 'yes',
            resolved: false,
            closed: false,
            acceptingOrders: true,
            endDate: new Date(Date.now() + 60_000),
          },
        ],
        [
          'c2',
          {
            conditionId: 'c2',
            tokenIdYes: null,
            resolved: false,
            closed: false,
          },
        ],
      ] as never),
    );

    const counts = await service.getStatusCounts();
    expect(counts).toEqual({
      enabledSelections: 2,
      selectionsWithMarket: 1,
      evaluableSelections: 1,
    });
  });
});
