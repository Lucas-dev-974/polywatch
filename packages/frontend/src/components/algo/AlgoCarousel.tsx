import type { JSX } from 'solid-js';

export interface AlgoCarouselProps {
  class?: string;
  setScrollRef: (el: HTMLDivElement) => void;
  children: JSX.Element;
}

export function AlgoCarousel(props: AlgoCarouselProps) {
  return (
    <div class={`algo-carousel${props.class ? ` ${props.class}` : ''}`} ref={props.setScrollRef}>
      {props.children}
    </div>
  );
}
