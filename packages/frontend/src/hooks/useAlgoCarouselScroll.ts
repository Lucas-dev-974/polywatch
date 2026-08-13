const DEFAULT_SCROLL_AMOUNT = 212;

export function useAlgoCarouselScroll(step: number = DEFAULT_SCROLL_AMOUNT) {
  let scrollRef: HTMLDivElement | undefined;

  function setScrollRef(el: HTMLDivElement) {
    scrollRef = el;
  }

  function scroll(direction: 'left' | 'right') {
    if (!scrollRef) return;
    const current = scrollRef.scrollLeft;
    const target = direction === 'left' ? current - step : current + step;
    scrollRef.scrollTo({ left: target, behavior: 'smooth' });
  }

  return {
    setScrollRef,
    scrollLeft: () => scroll('left'),
    scrollRight: () => scroll('right'),
  };
}
