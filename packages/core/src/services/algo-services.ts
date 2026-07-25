import type { DataSource } from 'typeorm';
import { AlgoMarketSelectionService } from './algo-market-selection.service.js';
import { MarketService } from './market.service.js';

/** Shared MarketService + AlgoMarketSelectionService wiring for backend and workers. */
export function createAlgoSelectionServices(ds: DataSource): {
  marketService: MarketService;
  selectionService: AlgoMarketSelectionService;
} {
  const marketService = new MarketService(ds);
  return {
    marketService,
    selectionService: new AlgoMarketSelectionService(ds, marketService),
  };
}
