import { Show, For, type Accessor } from 'solid-js';
import type { useCryptoAlgoSurveillance } from '../hooks/useCryptoAlgoSurveillance';
import type { useAlgoWorkerQueueStatus } from '../hooks/useAlgoWorkerQueueStatus';
import { workerQueueBadgeLabel } from '../lib/algo-worker-queue-status';
import { useAlgoCarouselScroll } from '../hooks/useAlgoCarouselScroll';
import { AlgoCarousel } from './algo/AlgoCarousel';
import { AlgoCarouselNav } from './algo/AlgoCarouselNav';
import { SurveillanceHistoryCard } from './SurveillanceHistoryCard';
import { Icon } from './Icon';

type SurveillanceState = ReturnType<typeof useCryptoAlgoSurveillance>;

export interface CryptoAlgoSurveillancePanelProps {
  surveillance: SurveillanceState;
  queueStatus: ReturnType<typeof useAlgoWorkerQueueStatus>;
  now: Accessor<number>;
}

export function CryptoAlgoSurveillancePanel(props: CryptoAlgoSurveillancePanelProps) {
  const carousel = useAlgoCarouselScroll();
  const s = () => props.surveillance;

  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">
          <Icon name="history" />
          Historique surveillance
        </h2>
        <div class="algo-panel-header-right">
          <Show when={props.queueStatus.status()}>
            {(q) => (
              <span
                class={`algo-queue-badge ${q().level}`}
                title={q().hint ?? undefined}
              >
                {workerQueueBadgeLabel(q())}
              </span>
            )}
          </Show>
          <Show when={s().total() > 0}>
            <div class="algo-pagination">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={s().page() === 0}
                onClick={() => s().goToPage(s().page() - 1)}
                aria-label="Page précédente"
              >
                <Icon name="chevron-left" size={16} />
              </button>
              <span class="algo-pagination-info">
                {s().page() + 1} / {s().pageCount()}
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={s().page() >= s().pageCount() - 1}
                onClick={() => s().goToPage(s().page() + 1)}
                aria-label="Page suivante"
              >
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          </Show>
          <AlgoCarouselNav
            visible={s().items().length > 0}
            onScrollLeft={carousel.scrollLeft}
            onScrollRight={carousel.scrollRight}
          />
          <span class="algo-panel-count">{s().total()} fenêtres</span>
        </div>
      </div>
      <Show
        when={s().items().length > 0}
        fallback={
          <div class="algo-empty">
            Aucun historique pour l'instant. Les prix d'ouverture (+5s) et de fermeture (+2s)
            des marchés surveillés apparaîtront ici automatiquement.
          </div>
        }
      >
        <AlgoCarousel class="algo-carousel-surveillance" setScrollRef={carousel.setScrollRef}>
          <For each={s().items()}>
            {(snapshot) => (
              <SurveillanceHistoryCard snapshot={snapshot} now={props.now()} />
            )}
          </For>
        </AlgoCarousel>
      </Show>
    </section>
  );
}
