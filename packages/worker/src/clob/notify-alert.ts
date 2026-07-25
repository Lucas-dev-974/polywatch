import pino from 'pino';
import { postBackendJson } from '../backend-client.js';

const log = pino({ name: 'notify-alert' });

export type AlertType = 'info' | 'warning' | 'error';

/** Push an operator alert to the backend (relayed to the UI banner). */
export async function notifyBackendAlert(
  type: AlertType,
  message: string,
): Promise<void> {
  try {
    await postBackendJson('/api/internal/alerts', { type, message });
  } catch (err) {
    log.warn({ err, type, message }, 'failed to notify backend alert');
  }
}
