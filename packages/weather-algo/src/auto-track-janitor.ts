import pino from 'pino';
import {
  WeatherAutoTrackService,
  type WeatherMarketSelectionService,
} from '@polywatch/core';

const log = pino({ name: 'weather-algo:auto-track-janitor' });

export async function runWeatherAutoTrackJanitorCycle(
  autoTrackService: WeatherAutoTrackService,
  selectionService: WeatherMarketSelectionService,
): Promise<{ disabled: number; added: number }> {
  log.info('weather auto-track janitor cycle started');
  const result = await autoTrackService.syncMarketSelectionsForAutoTrack(
    selectionService,
  );
  log.info(result, 'weather auto-track janitor cycle completed');
  return result;
}
