import { createEffect, createSignal } from 'solid-js';
import type { useClobCredentials } from './useClobCredentials';

type ClobCredentialsState = ReturnType<typeof useClobCredentials>;

export function useCredsSetupDialog(
  creds: ClobCredentialsState,
  onAfterClose?: () => void | Promise<void>,
) {
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    if (creds.needsSetup()) {
      setOpen(true);
    }
  });

  async function close() {
    if (creds.needsSetup()) return;
    await creds.refresh();
    if (onAfterClose) await onAfterClose();
    setOpen(false);
  }

  return { open, setOpen, close };
}
