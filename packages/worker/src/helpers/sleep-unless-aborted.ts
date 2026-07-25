/** Abortable sleep; resolves false if aborted before the delay elapses. */
export function sleepUnlessAborted(
  ms: number,
  abortSignal: AbortSignal,
): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(!abortSignal.aborted);
  if (abortSignal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}
