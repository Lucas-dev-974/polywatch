import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { connectSocket } from '../socket';
import { Icon } from './Icon';
import {
  pushNotifications,
  healthAlerts,
  addPushNotification,
  dismissPushNotification,
  clearPushNotifications,
} from '../stores/notificationStore';

function severityClass(type: string): string {
  if (type === 'error' || type === 'danger') return 'error';
  if (type === 'warn' || type === 'warning') return 'warning';
  return 'info';
}

function severityIcon(type: string): string {
  if (type === 'error' || type === 'danger') return '!';
  if (type === 'warn' || type === 'warning') return '\u26A0';
  return 'i';
}

export function NotificationCenter() {
  const [open, setOpen] = createSignal(false);

  const all = () => {
    const push = pushNotifications();
    const health = healthAlerts();
    const mapped = health.map((a, i) => ({
      id: -(i + 1),
      type: a.severity,
      message: `${a.title}: ${a.message}`,
      at: new Date(),
    }));
    return [...push, ...mapped];
  };

  const count = () => all().length;
  const hasError = () => all().some((n) => n.type === 'error' || n.type === 'danger');
  const hasWarning = () => all().some((n) => n.type === 'warn' || n.type === 'warning');

  function severity(): string | null {
    if (hasError()) return 'error';
    if (hasWarning()) return 'warning';
    if (count() > 0) return 'info';
    return null;
  }

  onMount(() => {
    const socket = connectSocket();
    const onAlert = (data: { type?: string; message?: string }) => {
      addPushNotification(data);
    };
    socket.on('alert', onAlert);
    onCleanup(() => socket.off('alert', onAlert));
  });

  return (
    <>
      <button
        type="button"
        class={`notif-center-btn${severity() ? ` notif-center-btn--${severity()}` : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={count() > 0 ? `Notifications (${count()})` : 'Notifications'}
      >
        <Icon name="bell" size={18} />
        <Show when={count() > 0}>
          <span class="notif-center-badge" aria-hidden="true">
            {count() > 99 ? '99+' : count()}
          </span>
        </Show>
      </button>

      <Show when={open()}>
        <Portal>
          <div class="notif-center-overlay" onClick={() => setOpen(false)} />
          <div class="notif-center-panel" role="dialog" aria-label="Notifications">
            <div class="notif-center-header">
              <h2 class="notif-center-title">Notifications</h2>
              <Show when={count() > 0}>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  onClick={() => {
                    clearPushNotifications();
                    setOpen(false);
                  }}
                >
                  Tout effacer
                </button>
              </Show>
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-icon notif-center-close"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <div class="notif-center-body">
              <Show
                when={count() > 0}
                fallback={
                  <div class="notif-center-empty">
                    <Icon name="bell" size={24} />
                    <p>Aucune notification.</p>
                  </div>
                }
              >
                <For each={all()}>
                  {(notification) => (
                    <div
                      class={`notif-center-item ${severityClass(notification.type)}`}
                      role="status"
                    >
                      <span class="notif-center-item-icon">
                        {severityIcon(notification.type)}
                      </span>
                      <div class="notif-center-item-content">
                        <span class="notif-center-item-type">
                          {notification.type}
                        </span>
                        <span class="notif-center-item-message">
                          {notification.message}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="notif-center-item-dismiss"
                        onClick={() => dismissPushNotification(notification.id)}
                        aria-label="Supprimer"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
