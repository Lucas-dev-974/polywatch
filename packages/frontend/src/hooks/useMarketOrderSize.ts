import { createEffect, createSignal } from 'solid-js';
import { api } from '../api';

export interface MarketOrderSizeInfo {
  assetId: string;
  minOrderShares: number;
  source: 'clob' | 'book' | 'fallback';
  effectiveEntryMos: number;
}

export function useMarketOrderSize(assetId: () => string | null | undefined) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [info, setInfo] = createSignal<MarketOrderSizeInfo | null>(null);

  createEffect(() => {
    const id = assetId();
    if (!id) {
      setInfo(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void api<MarketOrderSizeInfo>(
      `/market-chart/order-size?assetId=${encodeURIComponent(id)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setInfo(null);
        setError(
          e instanceof Error ? e.message : 'Impossible de charger le MOS',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  });

  return { loading, error, info };
}
