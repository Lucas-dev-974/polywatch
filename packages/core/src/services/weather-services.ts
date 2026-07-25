import type { DataSource } from 'typeorm';
import { MarketService } from './market.service.js';
import { WeatherMarketSelectionService } from './weather-market-selection.service.js';

export function createWeatherSelectionServices(ds: DataSource): {
  marketService: MarketService;
  selectionService: WeatherMarketSelectionService;
} {
  const marketService = new MarketService(ds);
  return {
    marketService,
    selectionService: new WeatherMarketSelectionService(ds),
  };
}