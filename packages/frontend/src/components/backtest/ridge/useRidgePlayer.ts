import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

/**
 * Player de replay pour le ridge plot. Avance sur une timeline de timestamps
 * triés (ticks marché), avec play/pause/seek/speed. L'animation utilise
 * requestAnimationFrame et avance proportionnellement au temps écoulé.
 */
export function useRidgePlayer(timeline: () => number[]) {
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [speed, setSpeed] = createSignal(1); // 0.5x, 1x, 2x, 4x, 8x

  const playheadT = createMemo(() => {
    const tl = timeline();
    const i = currentIndex();
    return tl.length > 0 && i < tl.length ? tl[i] : null;
  });
  const total = () => timeline().length;

  // P9 : clamp currentIndex quand la timeline change (ex. filtre date cible).
  createEffect(() => {
    const len = timeline().length;
    const i = currentIndex();
    if (len === 0) {
      setCurrentIndex(0);
      return;
    }
    if (i >= len) setCurrentIndex(len - 1);
  });

  // Animation : requestAnimationFrame. On avance de round(dt / TICK_MS * speed)
  // index par frame. À 1x, 50ms réels = 1 tick (~20 ticks/s).
  let rafId: number | null = null;
  let lastTs = 0;
  const TICK_MS = 50;

  const pause = () => {
    setIsPlaying(false);
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const play = () => {
    if (isPlaying() || total() === 0) return;
    setIsPlaying(true);
    lastTs = performance.now();
    const step = (now: number) => {
      const dt = now - lastTs;
      lastTs = now;
      const advance = Math.max(1, Math.round((dt / TICK_MS) * speed()));
      const next = currentIndex() + advance;
      if (next >= total() - 1) {
        setCurrentIndex(total() - 1); // P8 : figé à la fin
        pause();
        return;
      }
      setCurrentIndex(next);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  };

  const toggle = () => (isPlaying() ? pause() : play());

  const seekIndex = (i: number) => setCurrentIndex(Math.max(0, Math.min(i, total() - 1)));

  const reset = () => {
    pause();
    setCurrentIndex(0);
  };

  onCleanup(pause);

  return {
    isPlaying,
    playheadT,
    currentIndex,
    total,
    speed,
    setSpeed,
    play,
    pause,
    toggle,
    seekIndex,
    reset,
  };
}
