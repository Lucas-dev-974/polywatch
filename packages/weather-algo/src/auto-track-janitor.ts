import pino from 'pino';
import { WeatherAutoTrackService } from '@polywatch/core';

const log = pino({ name: 'weather-algo:auto-track-janitor' });

export async function runWeatherAutoTrackJanitorCycle(
  autoTrackService: WeatherAutoTrackService,
): Promise<{ disabled: number; added: number }> {
  log.info('weather auto-track janitor cycle started');
  const result = await autoTrackService.syncMarketSelectionsForAutoTrack();
  log.info(result, 'weather auto-track janitor cycle completed');
  return result;
}
