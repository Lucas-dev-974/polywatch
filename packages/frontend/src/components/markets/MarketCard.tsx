import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';

import {
  formatMarketEndTime,
  formatMarketVolume,
  formatOutcomePercent,
  isBinaryUpDown,
  marketListLabel,
  normalizedOutcomes,
  topOutcomes,
} from '../../lib/markets-list';
import { primaryMarketTagLabel } from '../../lib/market-tags';
import { CountdownTimer } from '../CountdownTimer';
import { Icon } from '../Icon';
import { MarketIcon } from '../position/MarketIcon';
import type { MarketListItemDto } from '@polywatch/core/market-list';
import { toggleAlgoMarket, isAlgoSelected } from '../../stores/algoMarketsStore';

interface Props {
  item: MarketListItemDto;
  onOpenMetrics: (item: MarketListItemDto) => void;
}

function PolymarketLink(props: {
  href: string;
  class?: string;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <a
      class={props.class}
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      title={props.title}
    >
      {props.children}
    </a>
  );
}

export function MarketCard(props: Props) {
  const item = () => props.item;
  const outcomeList = () => normalizedOutcomes(item());
  const outcomes = () => topOutcomes({ ...item(), outcomePrices: outcomeList() });
  const binaryUpDown = () => isBinaryUpDown({ ...item(), outcomePrices: outcomeList() });
  const categoryLabel = () =>
    primaryMarketTagLabel(item().tagSlugs, item().category, item().question) ??
    item().category;
  const endTime = () => formatMarketEndTime(item().endDate);
  const volumeLabel = () =>
    formatMarketVolume(item().volume ?? item().volume24hr);
  const label = () => marketListLabel(item());

  return (
    <article class="market-card">
      <header class="market-card-header">
        <MarketIcon conditionId={item().conditionId} label={label()} size={36} />
        <PolymarketLink
          class="market-card-title"
          href={item().url}
          title="Ouvrir sur Polymarket"
        >
          {label()}
        </PolymarketLink>
        <Show when={binaryUpDown()}>
          <CountdownTimer endDate={item().endDate} />
        </Show>
      </header>

      <Show
        when={!binaryUpDown()}
        fallback={
          <div class="market-card-binary">
            <For each={outcomeList()}>
              {(outcome) => (
                <PolymarketLink
                  class={`market-card-binary-btn market-card-binary-btn--${outcome.outcome}`}
                  href={item().url}
                >
                  <span class="market-card-binary-label">{outcome.outcome}</span>
                  <span class="market-card-binary-pct">
                    {formatOutcomePercent(outcome.price)}
                  </span>
                </PolymarketLink>
              )}
            </For>
          </div>
        }
      >
        <div class="market-card-outcomes">
          <For each={outcomes()}>
            {(outcome) => (
              <div class="market-card-outcome-row">
                <span class="market-card-outcome-name">{outcome.outcome}</span>
                <span class="market-card-outcome-pct">
                  {formatOutcomePercent(outcome.price)}
                </span>
                <div class="market-card-outcome-actions">
                  <PolymarketLink
                    class="market-card-btn market-card-btn--yes"
                    href={item().url}
                  >
                    Oui
                  </PolymarketLink>
                  <PolymarketLink
                    class="market-card-btn market-card-btn--no"
                    href={item().url}
                  >
                    Non
                  </PolymarketLink>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <footer class="market-card-footer">
        <div class="market-card-meta">
          <span class="market-card-volume">{volumeLabel()}</span>
          <Show when={categoryLabel() || endTime()}>
            <span class="market-card-sep">·</span>
            <span class="market-card-category">
              {[categoryLabel(), endTime()].filter(Boolean).join(' · ')}
            </span>
          </Show>
        </div>
        <div class="market-card-footer-actions">
          <button
            type="button"
            class={`market-card-algo-btn${isAlgoSelected(item().conditionId) ? ' active' : ''}`}
            title={isAlgoSelected(item().conditionId) ? 'Désélectionner du algo' : 'Ajouter au algo'}
            aria-pressed={isAlgoSelected(item().conditionId)}
            onClick={() => void toggleAlgoMarket({
              conditionId: item().conditionId,
              question: item().question,
              cryptoSymbol: item().cryptoSymbol,
              interval: item().interval,
              slug: item().slug,
            })}
          >
            Algo
          </button>
          <button
            type="button"
            class="market-card-metrics-btn"
            title="Métriques du marché"
            aria-label="Métriques du marché"
            onClick={() => props.onOpenMetrics(item())}
          >
            <Icon name="chart-line" size={16} />
          </button>
        </div>
      </footer>
    </article>
  );
}
