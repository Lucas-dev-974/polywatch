export function useHorizontalResize(options: {
  width: () => number;
  setWidth: (width: number) => void;
  min: number;
  max: () => number;
}) {
  function startResize(event: MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = options.width();

    function onMove(e: MouseEvent) {
      const next = Math.min(
        options.max(),
        Math.max(options.min, startWidth + (e.clientX - startX)),
      );
      options.setWidth(next);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing-columns');
    }

    document.body.classList.add('is-resizing-columns');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return { startResize };
}
