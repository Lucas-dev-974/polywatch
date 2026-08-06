import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import { CHART_CONFIG } from '../lib/equity-chart';

export function useChartWidth(ref: Accessor<HTMLElement | undefined>) {
  const [width, setWidth] = createSignal<number>(CHART_CONFIG.minWidth);

  createEffect(() => {
    const el = ref();
    if (!el) return;

    const readWidth = () => Math.max(1, el.getBoundingClientRect().width);

    const update = () => {
      const w = Math.max(CHART_CONFIG.minWidth, Math.floor(readWidth()));
      setWidth(w);
    };

    const rafId = requestAnimationFrame(update);

    const observer = new ResizeObserver(update);
    observer.observe(el);

    const timers = [50, 150, 500].map((ms) => setTimeout(update, ms));

    onCleanup(() => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      timers.forEach(clearTimeout);
    });
  });

  return width;
}
