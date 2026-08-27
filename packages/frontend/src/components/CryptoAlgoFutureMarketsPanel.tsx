import { For, Show, type Accessor } from 'solid-js';
import { useAlgoCarouselScroll } from '../hooks/useAlgoCarouselScroll';
import { AlgoCarousel } from './algo/AlgoCarousel';
import { AlgoCarouselNav } from './algo/AlgoCarouselNav';
import { AlgoMarketCard, type AlgoMarketPrice } from './algo/AlgoMarketCard';
import { Icon } from './Icon';

export interface CryptoAlgoFutureMarketsPanelProps {
  markets: AlgoMarketPrice[];
  now: Accessor<number>;
}

export function CryptoAlgoFutureMarketsPanel(props: CryptoAlgoFutureMarketsPanelProps) {
  const carousel = useAlgoCarouselScroll();

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">
          <Icon name="clock" />
          Marchés futurs
        </h2>
        <div class="algo-panel-header-right">
          <span class="algo-panel-count">{props.markets.length} marchés</span>
          <AlgoCarouselNav
            visible={props.markets.length > 0}
            onScrollLeft={carousel.scrollLeft}
            onScrollRight={carousel.scrollRight}
          />
        </div>
      </div>
      <Show
        when={props.markets.length > 0}
        fallback={
          <div class="algo-empty">
            Aucun marché futur détecté pour les règles auto-track actives.
          </div>
        }
      >
        <AlgoCarousel class="algo-carousel-future" setScrollRef={carousel.setScrollRef}>
          <For each={props.markets}>
            {(mp) => <AlgoMarketCard market={mp} now={props.now} />}
          </For>
        </AlgoCarousel>
      </Show>
    </section>
  );
}
