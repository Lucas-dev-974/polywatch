import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WatchlistEntry } from '@polywatch/core';

const log = pino({ name: 'weather-algo:watchlist-seed' });

export const WEATHER_ALGO_TRADER_ADDRESS = 'weather-algo';

/**
 * Idempotently seeds the weather-algo WatchlistEntry and returns its id.
 */
export async function seedWeatherAlgoWatchlistEntry(
  ds: DataSource,
): Promise<number> {
  const repo = ds.getRepository(WatchlistEntry);

  const existing = await repo.findOne({
    where: { traderAddress: WEATHER_ALGO_TRADER_ADDRESS },
  });

  if (existing) {
    log.info(
      { id: existing.id, traderAddress: WEATHER_ALGO_TRADER_ADDRESS },
      'weather-algo watchlist entry already exists',
    );
    return existing.id;
  }

  const entry = repo.create({
    traderAddress: WEATHER_ALGO_TRADER_ADDRESS,
    nickname: 'Weather Algo',
    active: true,
    simEnabled: true,
    realEnabled: true,
  });

  const saved = await repo.save(entry);
  log.info(
    { id: saved.id, traderAddress: WEATHER_ALGO_TRADER_ADDRESS },
    'created weather-algo watchlist entry',
  );
  return saved.id;
}