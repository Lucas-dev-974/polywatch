import pino from 'pino';
import { postBackendAlert } from '../backend-client.js';

const log = pino({ name: 'notify-alert' });

export type AlertType = 'info' | 'warning' | 'error';

/**
 * Push an operator alert to the backend (relayed to the UI banner).
 * Fire-and-forget: never blocks the caller (strategy loop, DLQ, etc.).
 */
export function notifyBackendAlert(type: AlertType, message: string): void {
  try {
    postBackendAlert('/api/internal/alerts', { type, message });
  } catch (err) {
    // postBackendAlert already swallows fetch errors; this guards sync throws.
    log.warn({ err, type, message }, 'failed to notify backend alert');
  }
}
