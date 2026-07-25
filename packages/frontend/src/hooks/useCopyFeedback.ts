import { createSignal } from 'solid-js';
import { copyToClipboard } from '../lib/clipboard';

const DEFAULT_FEEDBACK_MS = 1500;

export function useCopyFeedback<T = true>(durationMs = DEFAULT_FEEDBACK_MS) {
  const [copiedKey, setCopiedKey] = createSignal<T | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  async function copy(text: string, key: T = true as T): Promise<boolean> {
    if (!(await copyToClipboard(text))) return false;
    clearTimer();
    setCopiedKey(() => key as T | null);
    timer = setTimeout(() => {
      setCopiedKey(null);
      timer = undefined;
    }, durationMs);
    return true;
  }

  const isCopied = (key: T) => copiedKey() === key;

  return { copy, isCopied };
}
