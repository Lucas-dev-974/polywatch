import { createSignal, For, onMount, Show } from 'solid-js';

import { Icon } from '../Icon';
import { MarketCard } from '../markets/MarketCard';
import { MarketMetricsPanel } from '../panels/MarketMetricsPanel';
import { MarketSyncSettingsDialog } from '../dialogs/MarketSyncSettingsDialog';
import { MarketsCryptoCurrencyFilterBar } from '../markets/MarketsCryptoCurrencyFilterBar';
import { MarketsCryptoFilterBar } from '../markets/MarketsCryptoFilterBar';
import { MarketsIntervalSidebar } from '../markets/MarketsIntervalSidebar';
import { MarketsTagBar } from '../markets/MarketsTagBar';
import { useMarketsBrowse } from '../../hooks/useMarketsBrowse';
import { toMetricsPosition } from '../../lib/markets-list';
import { loadAlgoMarkets } from '../../stores/algoMarketsStore';
import type { MarketListItemDto } from '@polywatch/core/market-list';

export function MarketsPage() {
  const browse = useMarketsBrowse();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [metricsOpen, setMetricsOpen] = createSignal(false);
  const [syncSettingsOpen, setSyncSettingsOpen] = createSignal(false);
  const [selectedMarket, setSelectedMarket] = createSignal<MarketListItemDto | null>(
    null,
  );

  onMount(() => {
    void loadAlgoMarkets();
  });

  function openMetrics(item: MarketListItemDto) {
    setSelectedMarket(item);
    setMetricsOpen(true);
  }

  function closeMetrics() {
    setMetricsOpen(false);
    setSelectedMarket(null);
  }

  return (
    <>
      <div class="markets-browse">
        <header class="markets-browse-header">
          <h1 class="markets-browse-title">Tous les marchés</h1>
          <div class="markets-browse-actions">
            <button
              type="button"
              class={`btn btn-sm markets-active-interval-btn${browse.isCurrentOnly() ? ' active' : ''}`}
              aria-pressed={browse.isCurrentOnly()}
              onClick={() => void browse.toggleCurrentOnly()}
              title={browse.isCurrentOnly() ? 'Afficher tous les intervalles' : 'N\'afficher que l\'intervalle actif'}
            >
              <Icon name="clock" size={16} />
              Intervalle actif
            </button>
            <Show when={searchOpen()}>
              <input
                type="search"
                class="input markets-browse-search"
                placeholder="Rechercher un marché…"
                value={browse.searchQuery()}
                onInput={(e) => browse.setSearchQuery(e.currentTarget.value)}
              />
            </Show>
            <button
              type="button"
              class={`btn btn-ghost btn-sm markets-browse-icon-btn${searchOpen() ? ' active' : ''}`}
              title="Rechercher"
              aria-label="Rechercher"
              aria-pressed={searchOpen()}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <Icon name="search" size={18} />
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              title="Configuration de la synchronisation"
              onClick={() => setSyncSettingsOpen(true)}
            >
              Sync
            </button>
          </div>
        </header>

        <MarketsTagBar
          tags={browse.navTags}
          activeSlug={browse.activeTagSlug}
          onSelect={(slug) => void browse.selectTag(slug)}
        />

        <Show when={browse.isCryptoTab()}>
          <MarketsCryptoFilterBar
            activeCategory={browse.activeCategory}
            onSelectCategory={browse.selectCategory}
          />
        </Show>

        <Show when={browse.loading()}>
          <p class="markets-browse-status form-hint">Chargement des marchés…</p>
        </Show>

        <Show when={browse.error()}>
          <p class="markets-browse-status form-hint">{browse.error()}</p>
        </Show>

        <Show when={!browse.loading() && !browse.error()}>
          <Show
            when={browse.filteredItems().length > 0}
            fallback={
              <div class="empty-state markets-browse-empty">
                Aucun marché ouvert trouvé
              </div>
            }
          >
            <div class="markets-content">
              <Show when={browse.isCryptoTab()}>
                <aside class="markets-crypto-sidebar">
                  <MarketsCryptoCurrencyFilterBar
                    items={browse.items}
                    activeSymbol={browse.activeCryptoSymbol}
                    onSelectSymbol={browse.selectCryptoSymbol}
                  />
                  <MarketsIntervalSidebar
                    activeInterval={browse.activeInterval}
                    onSelectInterval={(interval) => void browse.selectInterval(interval)}
                  />
                </aside>
              </Show>
              <div class="markets-grid">
                <For each={browse.filteredItems()}>
                  {(item) => (
                    <MarketCard item={item} onOpenMetrics={openMetrics} />
                  )}
                </For>
              </div>
            </div>
          </Show>
        </Show>

        <Show when={browse.canPaginate()}>
          <footer class="markets-pagination">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={browse.cursorStack().length === 0 || browse.loading()}
              onClick={() => void browse.goToPreviousPage()}
            >
              Précédent
            </button>
            <span class="event-pagination-info">Page {browse.pageNumber()}</span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              disabled={!browse.nextCursor() || browse.loading()}
              onClick={() => void browse.goToNextPage()}
            >
              Suivant
            </button>
          </footer>
        </Show>
      </div>

      <Show when={selectedMarket()}>
        {(item) => (
          <MarketMetricsPanel
            open={metricsOpen()}
            onClose={closeMetrics}
            pos={toMetricsPosition(item())}
            liveTick={() => undefined}
            item={item()}
          />
        )}
      </Show>

      <MarketSyncSettingsDialog
        open={syncSettingsOpen()}
        onClose={() => setSyncSettingsOpen(false)}
      />
    </>
  );
}
