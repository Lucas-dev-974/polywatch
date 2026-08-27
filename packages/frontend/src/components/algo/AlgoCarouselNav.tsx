import { Show } from 'solid-js';
import { Icon } from '../Icon';

export interface AlgoCarouselNavProps {
  visible: boolean;
  onScrollLeft: () => void;
  onScrollRight: () => void;
}

export function AlgoCarouselNav(props: AlgoCarouselNavProps) {
  return (
    <Show when={props.visible}>
      <div class="algo-carousel-nav">
        <button
          type="button"
          class="btn btn-ghost btn-sm algo-carousel-btn"
          onClick={() => props.onScrollLeft()}
          aria-label="Défiler vers la gauche"
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm algo-carousel-btn"
          onClick={() => props.onScrollRight()}
          aria-label="Défiler vers la droite"
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </Show>
  );
}
