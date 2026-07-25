import { createSignal, type ParentProps } from 'solid-js';

import {
  type CollapsedSection,
  type UiMode,
  usePersistedCollapse,
} from '../lib/ui-persistence';

/**
 * Wraps content in a collapsible container with smooth max-height transition.
 * The parent is responsible for rendering the toggle button using the
 * `collapsed` signal and `toggle` function returned by `useCollapse()`.
 *
 * When `section` and `mode` are provided, the collapsed state is persisted.
 */
export function useCollapse(section?: CollapsedSection, mode?: UiMode) {
  if (section !== undefined && mode !== undefined) {
    return usePersistedCollapse(section, mode);
  }
  return createSignal(false);
}

type Props = {
  collapsed: boolean;
};

export function CollapsiblePanel(props: ParentProps<Props>) {
  return (
    <div
      class="panel-body-collapsible"
      classList={{ 'is-collapsed': props.collapsed }}
    >
      <div class="panel-body-collapsible-inner">
        {props.children}
      </div>
    </div>
  );
}
