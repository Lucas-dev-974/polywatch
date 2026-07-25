import { createSignal } from 'solid-js';
import type { CryptoAlgoHealthAlert } from '../lib/crypto-algo-health';

export interface PushNotification {
  id: number;
  type: string;
  message: string;
  at: Date;
}

const [pushNotifications, setPushNotifications] = createSignal<PushNotification[]>([]);
const [healthAlerts, setHealthAlerts] = createSignal<CryptoAlgoHealthAlert[]>([]);
let nextId = 0;

export function addPushNotification(data: { type?: string; message?: string }) {
  setPushNotifications((prev) => [
    {
      id: nextId++,
      type: data.type ?? 'info',
      message: data.message ?? JSON.stringify(data),
      at: new Date(),
    },
    ...prev.slice(0, 9),
  ]);
}

export function dismissPushNotification(id: number) {
  setPushNotifications((prev) => prev.filter((n) => n.id !== id));
}

export function clearPushNotifications() {
  setPushNotifications([]);
}

export function setCryptoAlgoAlerts(alerts: CryptoAlgoHealthAlert[]) {
  setHealthAlerts(alerts);
}

export { pushNotifications, healthAlerts };
