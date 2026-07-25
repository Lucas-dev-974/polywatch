interface CachedImage {
  body: Buffer;
  contentType: string;
  expiresAt: number;
}

export function createBoundedImageCache(maxEntries: number, ttlMs: number) {
  const cache = new Map<string, CachedImage>();

  return {
    get(key: string): CachedImage | undefined {
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expiresAt) {
        cache.delete(key);
        return undefined;
      }
      return entry;
    },

    set(key: string, body: Buffer, contentType: string): void {
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, {
        body,
        contentType,
        expiresAt: Date.now() + ttlMs,
      });
    },
  };
}
