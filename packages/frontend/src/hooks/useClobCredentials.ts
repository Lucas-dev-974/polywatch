import { createSignal } from 'solid-js';
import {
  fetchClobCredentialsStatus,
  liveTradingBlockMessage,
  type ClobCredentialsStatus,
  type LiveTradingBlockReason,
} from '../lib/clob-credentials';

export function useClobCredentials() {
  const [status, setStatus] = createSignal<ClobCredentialsStatus | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(false);

  async function refresh() {
    setLoading(true);
    try {
      setStatus(await fetchClobCredentialsStatus());
      setError(false);
    } catch {
      setStatus(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const configured = () => status()?.configured ?? false;
  const liveReady = () => status()?.liveReady ?? false;
  const blockReason = (): LiveTradingBlockReason | null =>
    status()?.blockReason ?? null;
  const blockMessage = () => liveTradingBlockMessage(blockReason());

  const needsSetup = () => !loading() && !error() && !configured();
  const needsLiveSetup = () =>
    !loading() && !error() && configured() && !liveReady();

  return {
    status,
    configured,
    liveReady,
    blockReason,
    blockMessage,
    loading,
    error,
    refresh,
    needsSetup,
    needsLiveSetup,
  };
}
