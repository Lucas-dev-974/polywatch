import { For, Show, type Accessor } from 'solid-js';
import { removeAlgoMarket, setAlgoMarketEnabled } from '../../stores/algoMarketsStore';
import { useAlgoCarouselScroll } from '../../hooks/useAlgoCarouselScroll';
import { AlgoCarousel } from '../algo/AlgoCarousel';
import { AlgoCarouselNav } from '../algo/AlgoCarouselNav';
import { AlgoMarketCard, type AlgoMarketPrice } from '../algo/AlgoMarketCard';
import { Icon } from '../Icon';

export interface CryptoAlgoLiveMarketsPanelProps {
  markets: AlgoMarketPrice[];
  now: Accessor<number>;
}

export function CryptoAlgoLiveMarketsPanel(props: CryptoAlgoLiveMarketsPanelProps) {
  const carousel = useAlgoCarouselScroll();

  return (
    <section class="algo-panel">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">
          <Icon name="eye" />
          {'March\u00E9s surveill\u00E9s'}
        </h2>
        <div class="algo-panel-header-right">
          <span class="algo-panel-count">{props.markets.length} march{'\u00E9'}s</span>
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
            {'Aucun march\u00E9 live. Les march\u00E9s expir\u00E9s sont automatiquement remplac\u00E9s par '}
            l'auto-track.
          </div>
        }
      >
        <AlgoCarousel setScrollRef={carousel.setScrollRef}>
          <For each={props.markets}>
            {(mp) => (
              <AlgoMarketCard
                market={mp}
                now={props.now}
                onToggleEnabled={(enabled) => void setAlgoMarketEnabled(mp.conditionId, enabled)}
                onRemove={() => void removeAlgoMarket(mp.conditionId)}
              />
            )}
          </For>
        </AlgoCarousel>
      </Show>
    </section>
  );
}
