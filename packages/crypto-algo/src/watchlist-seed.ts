import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WatchlistEntry } from '@polywatch/core';

const log = pino({ name: 'crypto-algo:watchlist-seed' });

/**
 * Sentinel traderAddress for the crypto-algo pipeline.
 */
export const CRYPTO_ALGO_TRADER_ADDRESS = 'crypto-algo';

/**
 * Idempotently seeds the crypto-algo WatchlistEntry and returns its id.
 *
 * The returned id is the watchlistId the pipeline should use when interacting
 * with the rest of the polywatch system (positions, executions, snapshots, etc).
 */
export async function seedCryptoAlgoWatchlistEntry(
  ds: DataSource,
): Promise<number> {
  const repo = ds.getRepository(WatchlistEntry);

  const existing = await repo.findOne({
    where: { traderAddress: CRYPTO_ALGO_TRADER_ADDRESS },
  });

  if (existing) {
    log.info(
      { id: existing.id, traderAddress: CRYPTO_ALGO_TRADER_ADDRESS },
      'crypto-algo watchlist entry already exists',
    );
    return existing.id;
  }

  const entry = repo.create({
    traderAddress: CRYPTO_ALGO_TRADER_ADDRESS,
    nickname: 'Crypto Algo',
    active: true,
    simEnabled: true,
    realEnabled: true,
  });

  const saved = await repo.save(entry);

  log.info(
    { id: saved.id, traderAddress: CRYPTO_ALGO_TRADER_ADDRESS },
    'created crypto-algo watchlist entry',
  );

  return saved.id;
}