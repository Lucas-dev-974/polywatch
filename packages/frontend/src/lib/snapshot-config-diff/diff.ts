import {
  CONFIG_DIFF_GROUP_ORDER,
  normalizePrimitive,
  snapshotHasEffectiveKey,
  SPECS_BY_MODE,
  type ConfigDiffGroup,
  type SnapshotConfigMode,
  type SnapshotConfigDiffInput,
} from './specs';

export interface ConfigDiffRow {
  key: string;
  label: string;
  group: ConfigDiffGroup;
  valuesBySnapshotId: Map<number, string>;
}

export function buildSnapshotConfigDiff(
  mode: SnapshotConfigMode,
  snapshots: SnapshotConfigDiffInput[],
): ConfigDiffRow[] {
  if (snapshots.length < 2) return [];

  const specs = SPECS_BY_MODE[mode];
  const rows: ConfigDiffRow[] = [];

  for (const spec of specs) {
    const normalizedById = new Map<number, string>();
    const displayById = new Map<number, string>();
    let skipAbsent = false;

    for (const snap of snapshots) {
      const config = (snap.config ?? {}) as Record<string, unknown>;
      if (!snapshotHasEffectiveKey(config, spec.key)) {
        skipAbsent = true;
        break;
      }
      const raw = config[spec.key];
      const norm = spec.normalize
        ? spec.normalize(raw, config)
        : normalizePrimitive(raw);
      normalizedById.set(snap.snapshotId, norm);
      displayById.set(snap.snapshotId, spec.format(raw, config));
    }

    if (skipAbsent) continue;

    const unique = new Set(normalizedById.values());
    if (unique.size <= 1) continue;

    rows.push({
      key: spec.key,
      label: spec.label,
      group: spec.group,
      valuesBySnapshotId: displayById,
    });
  }

  return rows.sort((a, b) => {
    const ga = CONFIG_DIFF_GROUP_ORDER.indexOf(a.group);
    const gb = CONFIG_DIFF_GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.label.localeCompare(b.label, 'fr');
  });
}

/** Compact card preview line for one selected entity among N. */
export interface ConfigDiffPreviewLine {
  key: string;
  label: string;
  group: ConfigDiffGroup;
  /** This entity's display value. */
  value: string;
  /**
   * Card label: own value, or `ref → value` when this entity differs from the
   * reference on that key.
   */
  changeLabel: string;
}

export function groupConfigDiffPreviewLines(
  lines: ConfigDiffPreviewLine[],
): [ConfigDiffGroup, ConfigDiffPreviewLine[]][] {
  const map = new Map<ConfigDiffGroup, ConfigDiffPreviewLine[]>();
  for (const line of lines) {
    const list = map.get(line.group) ?? [];
    list.push(line);
    map.set(line.group, list);
  }
  return CONFIG_DIFF_GROUP_ORDER.filter((g) => map.has(g)).map((g) => [
    g,
    map.get(g)!,
  ]);
}

/**
 * Differing config keys for one entity in an N-way compare (≥2).
 * Non-reference entities that diverge show `ref → value`.
 */
export function buildConfigDiffPreviewLines(
  mode: SnapshotConfigMode,
  snapshots: SnapshotConfigDiffInput[],
  entityId: number,
  referenceId: number,
): ConfigDiffPreviewLine[] {
  if (snapshots.length < 2) return [];

  const rows = buildSnapshotConfigDiff(mode, snapshots);
  return rows.map((row) => {
    const value = row.valuesBySnapshotId.get(entityId) ?? '—';
    const refValue = row.valuesBySnapshotId.get(referenceId) ?? '—';
    const changeLabel =
      entityId !== referenceId && value !== refValue
        ? `${refValue} → ${value}`
        : value;
    return {
      key: row.key,
      label: row.label,
      group: row.group,
      value,
      changeLabel,
    };
  });
}
