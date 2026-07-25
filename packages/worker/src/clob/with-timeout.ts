function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('aborted');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorCode: string,
  abortSignal?: AbortSignal,
): Promise<T> {
  if (abortSignal?.aborted) {
    throw abortError(abortSignal);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      promise.then((value) => {
        if (abortSignal?.aborted) {
          throw abortError(abortSignal);
        }
        return value;
      }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), ms);
        if (abortSignal) {
          onAbort = () => reject(abortError(abortSignal));
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortSignal && onAbort) {
      abortSignal.removeEventListener('abort', onAbort);
    }
  }
}
