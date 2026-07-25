import pino from 'pino';
import { postBackendJson } from '../backend-client.js';

const log = pino({ name: 'backend-notify' });

export async function notifyMoveEventsChanged(): Promise<void> {
  try {
    await postBackendJson('/api/internal/move-detected', {});
  } catch (err) {
    log.warn({ err }, 'move events notify failed');
  }
}
