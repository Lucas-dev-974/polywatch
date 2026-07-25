const DEFAULT_TTL_MS = 30_000;

const pending = new Map<string, number>();

/** Keep a move asset subscribed until a copied position exists or TTL expires. */
export function registerPendingMoveAsset(
  assetId: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  pending.set(assetId, Date.now() + ttlMs);
}

function pruneExpired(now = Date.now()): void {
  for (const [assetId, expiresAt] of Array.from(pending.entries())) {
    if (expiresAt <= now) pending.delete(assetId);
  }
}

export function getPendingMoveAssetIds(): string[] {
  pruneExpired();
  return Array.from(pending.keys());
}