import type { JSX } from 'solid-js';

interface Props {
  meta: JSX.Element;
  footer?: JSX.Element;
  aside: JSX.Element;
  children: JSX.Element;
}

export function PositionRow(props: Props) {
  return (
    <article class="position-row">
      <div class="position-row-body">
        {props.children}
        <p class="position-row-meta">{props.meta}</p>
        {props.footer}
      </div>
      <div class="position-row-aside">{props.aside}</div>
    </article>
  );
}

export function PositionRowMetaSep(props: { char?: string }) {
  return (
    <span class="position-row-meta-sep">{props.char ?? '·'}</span>
  );
}
