import type { DataSource } from 'typeorm';
import { Market } from '@polywatch/core';

/** Alert when a market has had winningTokenId set without official resolution. */
export const UNRESOLVED_WINNING_TOKEN_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Count markets where winningTokenId is known (sub-token outcome from CLOB price)
 * but the contract is not yet officially resolved, and the row has been stale
 * for longer than {@link UNRESOLVED_WINNING_TOKEN_STALE_MS}.
 */
export async function countStaleUnresolvedWinningTokenMarkets(
  ds: DataSource,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - UNRESOLVED_WINNING_TOKEN_STALE_MS);
  return ds
    .getRepository(Market)
    .createQueryBuilder('m')
    .where('m.winning_token_id IS NOT NULL')
    .andWhere('m.resolved = false')
    .andWhere('m.updated_at < :cutoff', { cutoff })
    .getCount();
}
