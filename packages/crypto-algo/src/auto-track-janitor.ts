import pino from 'pino';
import {
  AlgoAutoTrackService,
  AlgoMarketSelectionService,
  resolveMarketJanitorIntervalMs,
} from '@polywatch/core';

const log = pino({ name: 'crypto-algo:auto-track-janitor' });

export {
  DEFAULT_JANITOR_MS,
  SHORT_INTERVAL_JANITOR_MS,
} from '@polywatch/core';

export { resolveMarketJanitorIntervalMs };

/** Unified market janitor cycle: disable resolved selections, then discover missing markets. */
export async function runMarketJanitorCycle(
  autoTrackService: AlgoAutoTrackService,
  algoSelectionService: AlgoMarketSelectionService,
): Promise<{ disabled: number; disabledIds: string[]; added: number; purged: number }> {
  log.info('market janitor cycle started');
  const result = await autoTrackService.syncMarketSelectionsForAutoTrack(
    algoSelectionService,
  );
  const purged = await algoSelectionService.purgeDisabled();
  if (purged > 0) {
    log.info({ purged }, 'purged old disabled market selections');
  }
  log.info({ ...result, purged }, 'market janitor cycle completed');
  return { ...result, purged };
}
