export const DEFAULT_OUTCOME_LABEL = 'Yes';

export function normalizeOutcome(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function coalesceOutcome(
  ...sources: (string | null | undefined)[]
): string | undefined {
  for (const source of sources) {
    const normalized = normalizeOutcome(source);
    if (normalized) return normalized;
  }
  return undefined;
}

export function resolveOutcomeLabel(value?: string | null): string {
  return normalizeOutcome(value) ?? DEFAULT_OUTCOME_LABEL;
}
