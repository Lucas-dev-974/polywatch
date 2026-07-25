import { createSignal, onCleanup, onMount } from 'solid-js';
import { hasMetaMask } from '../lib/ethereum';

export function useMetaMaskAvailable() {
  const [available, setAvailable] = createSignal(false);

  onMount(() => {
    const refresh = () => setAvailable(hasMetaMask());
    refresh();
    window.addEventListener('ethereum#initialized', refresh);
    window.addEventListener('focus', refresh);
    onCleanup(() => {
      window.removeEventListener('ethereum#initialized', refresh);
      window.removeEventListener('focus', refresh);
    });
  });

  return available;
}
