import type { MarketListItemDto, MarketPercentUpdate } from '@polywatch/core/market-list';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';

import {
  CRYPTO_MARKETS_FETCH_LIMIT,
  CRYPTO_TAG_SLUG,
  fetchMarketsList,
  filterMarketItems,
  MARKETS_PAGE_SIZE,
  mergeOutcomePrices,
  resolveIntervalTagSlug,
  SHORT_RECURRING_INTERVALS,
} from '../lib/markets-list';
import { fetchMarketTags, type GammaTag } from '../lib/market-tags';
import { connectSocket, socket } from '../socket';

export function useMarketsBrowse() {
  const [items, setItems] = createSignal<MarketListItemDto[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [cursorStack, setCursorStack] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [navTags, setNavTags] = createSignal<GammaTag[]>([]);
  const [activeTagSlug, setActiveTagSlug] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
  const [activeInterval, setActiveInterval] = createSignal<string | null>(null);
  const [activeCryptoSymbol, setActiveCryptoSymbol] = createSignal<string | null>(null);
  const [isCurrentOnly, setIsCurrentOnly] = createSignal(false);

  const isCryptoTab = createMemo(() => activeTagSlug() === CRYPTO_TAG_SLUG);

  const pageNumber = () => cursorStack().length + 1;

  const filteredItems = createMemo(() =>
    filterMarketItems(items(), {
      searchQuery: searchQuery(),
      cryptoCategory: activeCategory(),
      interval: activeInterval(),
      cryptoSymbol: activeCryptoSymbol(),
    }),
  );

  const hasClientSideFilters = () =>
    Boolean(
      searchQuery().trim() || activeCategory() || activeCryptoSymbol(),
    );

  const canPaginate = () =>
    !loading() && items().length > 0 && !hasClientSideFilters();

  function clearSearch() {
    setSearchQuery('');
  }

  function resetPagination() {
    setCursorStack([]);
    clearSearch();
  }

  function resetCryptoFilters() {
    setActiveCategory(null);
    setActiveInterval(null);
    setActiveCryptoSymbol(null);
  }

  /** Resolve the Gamma tag slug for the current browse state. */
  function resolveFetchTagSlug(): string | undefined {
    const tagSlug = activeTagSlug();
    if (tagSlug !== CRYPTO_TAG_SLUG) {
      return tagSlug ?? undefined;
    }
    return resolveIntervalTagSlug(activeInterval()) ?? CRYPTO_TAG_SLUG;
  }

  async function loadMarkets() {
    setLoading(true);
    setError(null);
    try {
      const stack = cursorStack();
      const afterCursor = stack.length > 0 ? stack[stack.length - 1] : undefined;
      const tagSlug = resolveFetchTagSlug();
      // Broad crypto browse loads a larger batch for client-side category filters.
      // Interval-specific tags (5M, 15M, …) already return a focused set.
      const limit =
        isCryptoTab() && !activeInterval()
          ? CRYPTO_MARKETS_FETCH_LIMIT
          : MARKETS_PAGE_SIZE;
      const result = await fetchMarketsList({
        limit,
        afterCursor,
        tagSlug,
        activeOnly: isCurrentOnly() || undefined,
      });
      setItems(result.items);
      setNextCursor(result.nextCursor);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }

  async function selectTag(slug: string | null) {
    setActiveTagSlug(slug);
    resetCryptoFilters();
    resetPagination();
    setIsCurrentOnly(false);
    await loadMarkets();
  }

  function selectCategory(category: string | null) {
    setActiveCategory(category);
  }

  function selectCryptoSymbol(symbol: string | null) {
    setActiveCryptoSymbol(symbol);
  }

  async function selectInterval(interval: string | null) {
    setActiveInterval(interval);
    if (!isCryptoTab()) return;

    if (interval && SHORT_RECURRING_INTERVALS.has(interval)) {
      setActiveCategory('up-down');
    }

    setCursorStack([]);
    await loadMarkets();
  }

  async function toggleCurrentOnly() {
    const next = !isCurrentOnly();
    setIsCurrentOnly(next);
    setCursorStack([]);
    await loadMarkets();
  }

  async function goToNextPage() {
    const cursor = nextCursor();
    if (!cursor) return;
    clearSearch();
    setCursorStack((stack) => [...stack, cursor]);
    await loadMarkets();
  }

  async function goToPreviousPage() {
    if (cursorStack().length === 0) return;
    clearSearch();
    setCursorStack((stack) => stack.slice(0, -1));
    await loadMarkets();
  }

  onMount(async () => {
    try {
      const data = await fetchMarketTags();
      setNavTags(data.nav);
    } catch {
      setNavTags([]);
    }
    await loadMarkets();

    connectSocket();

    const sock = socket;
    if (!sock) return;

    const onPctUpdate = (updates: MarketPercentUpdate[]) => {
      setItems((current) => {
        const byConditionId = new Map(
          updates.map((u) => [u.conditionId, u.outcomePrices]),
        );
        return current.map((item) => {
          const incoming = byConditionId.get(item.conditionId);
          if (!incoming || incoming.length === 0) return item;

          const merged = mergeOutcomePrices(item.outcomePrices, incoming);
          return { ...item, outcomePrices: merged };
        });
      });
    };

    sock.on('market_pct_update', onPctUpdate);
    onCleanup(() => {
      sock.off('market_pct_update', onPctUpdate);
    });
  });

  return {
    items,
    filteredItems,
    loading,
    error,
    navTags,
    isCryptoTab,
    activeTagSlug,
    searchQuery,
    setSearchQuery,
    pageNumber,
    nextCursor,
    cursorStack,
    canPaginate,
    selectTag,
    selectCategory,
    selectCryptoSymbol,
    selectInterval,
    toggleCurrentOnly,
    goToNextPage,
    goToPreviousPage,
    activeCategory,
    activeInterval,
    activeCryptoSymbol,
    isCurrentOnly,
    setIsCurrentOnly,
  };
}
