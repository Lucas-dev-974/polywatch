import { createSignal } from 'solid-js';

export function useFormSave() {
  const [saving, setSaving] = createSignal(false);

  async function runSave<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setSaving(true);
    try {
      return await fn();
    } finally {
      setSaving(false);
    }
  }

  return {
    saving,
    runSave,
    saveLabel: (idle: string, busy = 'Enregistrement…') =>
      saving() ? busy : idle,
  };
}
