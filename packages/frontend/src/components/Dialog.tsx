import { JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useDialog } from '../hooks/useDialog';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  class?: string;
  bodyClass?: string;
  /** Overlay + dialog occupy the full viewport (no margin, no radius). */
  fullscreen?: boolean;
  headerExtra?: JSX.Element;
  children: JSX.Element;
}

export function Dialog(props: DialogProps) {
  useDialog(() => props.open, props.onClose);

  return (
    <Portal>
      <div
        class="dialog-overlay"
        classList={{
          'is-open': props.open,
          'dialog-overlay--fullscreen': !!props.fullscreen,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          class={`dialog ${props.class ?? ''}`.trim()}
          classList={{ 'dialog--fullscreen': !!props.fullscreen }}
          role="dialog"
          aria-modal="true"
          aria-hidden={!props.open}
          aria-labelledby={props.titleId}
        >
          <div class="dialog-header">
            <div class="dialog-title-group">
              <h2 id={props.titleId}>{props.title}</h2>
              {props.headerExtra}
            </div>
            <button
              class="btn btn-ghost btn-sm btn-icon"
              title="Fermer"
              onClick={() => props.onClose()}
            >
              ✕
            </button>
          </div>

          <div class={`dialog-body ${props.bodyClass ?? ''}`.trim()}>{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}
