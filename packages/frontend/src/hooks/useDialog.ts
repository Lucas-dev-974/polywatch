import { Accessor, createEffect, onCleanup } from 'solid-js';

export function useDialog(open: Accessor<boolean>, onClose: () => void) {
  createEffect(() => {
    if (!open()) return;

    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    });
  });
}
