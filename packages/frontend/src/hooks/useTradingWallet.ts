import { createSignal, onCleanup, onMount } from 'solid-js';
import { debounceFn } from '../lib/debounce';
import { fetchWallet, tradingWalletSnapshot, type WalletData } from '../lib/wallet';
import { connectSocket } from '../socket';

const WALLET_REFRESH_DEBOUNCE_MS = 500;

export function useTradingWallet() {
  const [wallet, setWallet] = createSignal<WalletData | null>(null);

  async function refresh() {
    try {
      setWallet(await fetchWallet());
    } catch {
      setWallet(null);
    }
  }

  onMount(() => {
    void refresh();
    const socket = connectSocket();
    // Unsubscribe with the handler reference: a bare socket.off('event')
    // would also remove every other component's listener on the shared socket.
    const refreshDebounced = debounceFn(() => void refresh(), WALLET_REFRESH_DEBOUNCE_MS);
    const onPositionUpdate = () => void refresh();
    socket.on('position_update', onPositionUpdate);
    socket.on('pnl_tick', refreshDebounced);
    onCleanup(() => {
      socket.off('position_update', onPositionUpdate);
      socket.off('pnl_tick', refreshDebounced);
      refreshDebounced.cancel();
    });
  });

  const snapshot = () => {
    const data = wallet();
    return data ? tradingWalletSnapshot(data) : null;
  };

  return { wallet, snapshot, refresh };
}
