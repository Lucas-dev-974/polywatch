import { createSignal, Show, type JSX } from 'solid-js';
import { readPersisted, writePersisted } from '../lib/ui-persistence';

export interface CollapsibleSectionProps {
  title: JSX.Element;
  defaultCollapsed?: boolean;
  persistKey?: string;
  headerActions?: JSX.Element;
  class?: string;
  children: JSX.Element;
}

export function CollapsibleSection(props: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = createSignal<boolean>(
    props.persistKey
      ? readPersisted(props.persistKey, props.defaultCollapsed ?? false, isBoolean)
      : props.defaultCollapsed ?? false,
  );

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      if (props.persistKey) writePersisted(props.persistKey, next);
      return next;
    });
  }

  return (
    <section
      class={`algo-panel weather-collapsible${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'weather-collapsible--collapsed': collapsed() }}
    >
      <div class="algo-panel-header weather-collapsible-header">
        <button
          type="button"
          class="weather-collapsible-toggle"
          onClick={toggle}
          aria-expanded={!collapsed()}
        >
          <span class="weather-collapsible-chevron" aria-hidden="true">
            {collapsed() ? '▸' : '▾'}
          </span>
          <h2 class="algo-panel-title">{props.title}</h2>
        </button>
        <Show when={props.headerActions}>
          <div class="weather-collapsible-actions" onClick={(e) => e.stopPropagation()}>
            {props.headerActions}
          </div>
        </Show>
      </div>
      <Show when={!collapsed()}>
        <div class="weather-collapsible-body">{props.children}</div>
      </Show>
    </section>
  );
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}