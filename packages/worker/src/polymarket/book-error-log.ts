import type { Logger } from 'pino';
import type { DataSource } from 'typeorm';
import { SystemConfigService } from '@polywatch/core/services/system-config.service';

/** system_config key — when false, CLOB book 404 warnings are suppressed. */
export const LOG_BOOK_404_ERRORS_KEY = 'worker.log.book_404_errors';

let service: SystemConfigService | null = null;

/** Call once at worker boot after DataSource init. */
export function initBook404LogConfig(ds: DataSource): void {
  service = new SystemConfigService(ds);
}

export function isClobBook404(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('CLOB book error: 404');
}

/**
 * Log a book fetch failure. Transient CLOB 404s are expected for new/expired
 * tokens and are suppressed unless `worker.log.book_404_errors` is true.
 * Non-404 errors are always logged.
 */
export async function logBookFetchFailure(
  log: Logger,
  err: unknown,
  assetId: string,
  msg: string,
): Promise<void> {
  if (isClobBook404(err)) {
    const enabled = service
      ? await service.getBoolean(LOG_BOOK_404_ERRORS_KEY, false)
      : false;
    if (!enabled) return;
  }
  log.warn({ err, assetId }, msg);
}
