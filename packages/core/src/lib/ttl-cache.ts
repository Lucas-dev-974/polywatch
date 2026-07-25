export function createTtlCache<T>(ttlMs: number) {
  let cached: T | null = null;
  let cachedAt = 0;
  let inflight: Promise<T> | null = null;

  return function load(loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (cached !== null && now - cachedAt < ttlMs) {
      return Promise.resolve(cached);
    }
    if (!inflight) {
      inflight = loader()
        .then((value) => {
          cached = value;
          cachedAt = Date.now();
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
