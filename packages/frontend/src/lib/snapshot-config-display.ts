export function formatSnapshotConfigValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.stringify(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return String(value);
}

export interface SnapshotConfigSection {
  title: string;
  entries: [string, unknown][];
}

/** Group snapshot config keys for display (Copy lane vs Crypto Algo). */
export function groupSnapshotConfigEntries(
  config: Record<string, unknown>,
): SnapshotConfigSection[] {
  const copy: [string, unknown][] = [];
  const algo: [string, unknown][] = [];
  const other: [string, unknown][] = [];

  for (const [key, value] of Object.entries(config)) {
    if (key === 'simAllowedMarketTags' || key === 'realAllowedMarketTags') continue;
    if (key.startsWith('cryptoAlgo')) {
      algo.push([key, value]);
    } else if (key.startsWith('sim') || key.startsWith('real') || key === 'slConfirmationTicks' || key === 'shadowSampleRetentionDays') {
      copy.push([key, value]);
    } else {
      other.push([key, value]);
    }
  }

  copy.sort(([a], [b]) => a.localeCompare(b, 'fr'));
  algo.sort(([a], [b]) => a.localeCompare(b, 'fr'));
  other.sort(([a], [b]) => a.localeCompare(b, 'fr'));

  const sections: SnapshotConfigSection[] = [];
  if (copy.length > 0) sections.push({ title: 'Copy · lane', entries: copy });
  if (algo.length > 0) sections.push({ title: 'Crypto Algo', entries: algo });
  if (other.length > 0) sections.push({ title: 'Autre', entries: other });
  return sections;
}
