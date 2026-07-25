const SCROLL_AMOUNT = 212;

export function useAlgoCarouselScroll() {
  let scrollRef: HTMLDivElement | undefined;

  function setScrollRef(el: HTMLDivElement) {
    scrollRef = el;
  }

  function scroll(direction: 'left' | 'right') {
    if (!scrollRef) return;
    const current = scrollRef.scrollLeft;
    const target =
      direction === 'left' ? current - SCROLL_AMOUNT : current + SCROLL_AMOUNT;
    scrollRef.scrollTo({ left: target, behavior: 'smooth' });
  }

  return {
    setScrollRef,
    scrollLeft: () => scroll('left'),
    scrollRight: () => scroll('right'),
  };
}
