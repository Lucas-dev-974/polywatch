import {
  CRYPTO_ALGO_SNAPSHOT_KEYS,
  REAL_RISK_CONFIG_KEYS,
  SIM_RISK_CONFIG_KEYS,
  type RealRiskConfigKey,
  type SimRiskConfigKey,
} from '@polywatch/core/risk/sim-mode-fields';
import {
  isSnapshotSimSlEnabled,
  isSnapshotSimTpEnabled,
  type SnapshotExitConfig,
} from '../sim-snapshot-compare';

export type SnapshotConfigMode = 'sim' | 'real';

export type ConfigDiffGroup =
  | 'entry'
  | 'exit'
  | 'risk'
  | 'copy'
  | 'snapshots'
  | 'execution'
  | 'crypto_algo'
  | 'other';

export const CONFIG_DIFF_GROUP_ORDER: ConfigDiffGroup[] = [
  'entry',
  'copy',
  'exit',
  'risk',
  'crypto_algo',
  'snapshots',
  'execution',
  'other',
];

export interface ConfigDiffFieldSpec {
  key: string;
  label: string;
  group: ConfigDiffGroup;
  format: (value: unknown, config: Record<string, unknown>) => string;
  normalize?: (value: unknown, config: Record<string, unknown>) => string;
}

export interface SnapshotConfigDiffInput {
  snapshotId: number;
  config: Record<string, unknown> | null | undefined;
}

const GROUP_LABELS: Record<ConfigDiffGroup, string> = {
  entry: 'Copy · Entrée & sizing',
  exit: 'Copy · Sorties',
  risk: 'Risque lane',
  copy: 'Copy · Ajustements',
  snapshots: 'Snapshots auto',
  execution: 'Exécution sim',
  crypto_algo: 'Crypto Algo',
  other: 'Autre',
};

const SIZING_MODE_LABELS: Record<string, string> = {
  fixed_usdc: 'Montant fixe (pUSD)',
  fixed_shares: 'Nombre de parts fixe',
  fixed_ratio: 'Ratio fixe',
  proportional_capital: 'Proportionnel au capital',
  kelly_fractional: 'Kelly fractionnel',
  risk_based: 'Basé sur le risque',
};

function formatBool(value: unknown): string {
  if (value === true) return 'Oui';
  if (value === false) return 'Non';
  return '—';
}

function formatNumber(value: unknown): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function formatTags(value: unknown): string {
  if (!Array.isArray(value)) return '—';
  const tags = value.map(String).filter(Boolean).sort();
  return tags.length > 0 ? tags.join(', ') : '(aucun)';
}

function formatSizing(value: unknown): string {
  if (typeof value !== 'string') return '—';
  return SIZING_MODE_LABELS[value] ?? value;
}

function deepStableStringify(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(deepStableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${deepStableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function normalizePrimitive(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(6) : 'nan';
  if (Array.isArray(value)) {
    return JSON.stringify([...value].map(String).sort());
  }
  if (typeof value === 'object') {
    return deepStableStringify(value);
  }
  return String(value);
}

function normalizeJsonLike(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return normalizePrimitive(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return normalizePrimitive(value);
}

function formatJsonCompact(value: unknown): string {
  if (value == null) return '—';
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
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function normalizeStrategies(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].map(String).sort());
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return JSON.stringify([...parsed].map(String).sort());
      }
    } catch {
      /* fall through */
    }
    return value;
  }
  return normalizePrimitive(value);
}

function formatStrategies(value: unknown): string {
  if (Array.isArray(value)) {
    const tags = value.map(String).filter(Boolean).sort();
    return tags.length > 0 ? tags.join(', ') : '(aucune)';
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const tags = parsed.map(String).filter(Boolean).sort();
        return tags.length > 0 ? tags.join(', ') : '(aucune)';
      }
    } catch {
      return value || '—';
    }
  }
  return '—';
}

function simSlEnabledNormalize(_v: unknown, config: Record<string, unknown>): string {
  return isSnapshotSimSlEnabled(config as SnapshotExitConfig) ? '1' : '0';
}

function simTpEnabledNormalize(_v: unknown, config: Record<string, unknown>): string {
  return isSnapshotSimTpEnabled(config as SnapshotExitConfig) ? '1' : '0';
}

/** Key present directly or via legacy fields used by normalize/format. */
export function snapshotHasEffectiveKey(config: Record<string, unknown>, key: string): boolean {
  if (key in config) return true;
  if (key === 'simSlEnabled' || key === 'simTpEnabled') {
    return 'simSlTpEnabled' in config;
  }
  return false;
}

function buildSimFieldSpecs(): ConfigDiffFieldSpec[] {
  const labelByKey: Partial<Record<SimRiskConfigKey, { label: string; group: ConfigDiffGroup }>> = {
    simSizingMode: { label: 'Mode de sizing', group: 'entry' },
    simCopyRatio: { label: 'Ratio de copy', group: 'entry' },
    simEntryUsdcAmount: { label: 'Montant entrée (pUSD)', group: 'entry' },
    simEntryShareCount: { label: 'Parts à l\'entrée', group: 'entry' },
    simKellyFraction: { label: 'Fraction Kelly', group: 'entry' },
    simRiskBudgetUsdc: { label: 'Budget risque (pUSD)', group: 'entry' },
    simDefaultWinProbability: { label: 'Probabilité de gain par défaut', group: 'entry' },
    simMaxPositionSizeUsdc: { label: 'Taille max position', group: 'risk' },
    simMaxOpenPositions: { label: 'Max positions ouvertes', group: 'risk' },
    simMaxExposureUsdc: { label: 'Exposition max', group: 'risk' },
    simMaxDailyLossUsdc: { label: 'Perte journalière max', group: 'risk' },
    simKillSwitchAction: { label: 'Action kill switch', group: 'risk' },
    simAllowedMarketTags: { label: 'Tags marché autorisés', group: 'entry' },
    simSignalScoreSizingEnabled: { label: 'Sizing par score signal', group: 'entry' },
    simMinBidToAskRatio: { label: 'Ratio bid/ask min', group: 'entry' },
    simMomentumFilterEnabled: { label: 'Filtre momentum', group: 'entry' },
    simCopyIncreaseEnabled: { label: 'Copier augmentations', group: 'copy' },
    simCopyDecreaseEnabled: { label: 'Copier réductions', group: 'copy' },
    simMaxIncreasesPerPosition: { label: 'Max augmentations / position', group: 'copy' },
    simSlEnabled: { label: 'Stop-loss activé', group: 'exit' },
    simTpEnabled: { label: 'Take-profit activé', group: 'exit' },
    simSlPercent: { label: 'SL (% de la mise)', group: 'exit' },
    simSlCloseMaxRetries: { label: 'SL — max tentatives', group: 'exit' },
    simTpPercent: { label: 'TP (% de la mise)', group: 'exit' },
    simTrailingEnabled: { label: 'Trailing stop', group: 'exit' },
    simTrailingPercent: { label: 'Trailing (% de la mise)', group: 'exit' },
    simTrailingActivationPercent: { label: 'Activation trailing (% de la mise)', group: 'exit' },
    simPreCloseEnabled: { label: 'Pré-clôture', group: 'exit' },
    simPreCloseSeconds: { label: 'Pré-clôture (s)', group: 'exit' },
    simPreCloseKeepEnabled: { label: 'Pré-clôture Keep', group: 'exit' },
    simPreCloseKeepBidThreshold: { label: 'Seuil Keep bid', group: 'exit' },
    simMinTimeToClose: { label: 'Temps min avant clôture', group: 'exit' },
    simAutoSnapshotEnabled: { label: 'Snapshots auto', group: 'snapshots' },
    simAutoSnapshotIntervalSeconds: { label: 'Intervalle auto (s)', group: 'snapshots' },
    simAutoSnapshotEmptySession: { label: 'Snapshot session vide', group: 'snapshots' },
    simSnapshotMaxCount: { label: 'Max snapshots', group: 'snapshots' },
    simSnapshotRetentionDays: { label: 'Rétention snapshots (j)', group: 'snapshots' },
    simSnapshotDecisionWindowHours: { label: 'Fenêtre journal décisions (h)', group: 'snapshots' },
    simExecLatencyMode: { label: 'Latence exécution (mode)', group: 'execution' },
    simExecLatencyMs: { label: 'Latence exécution (ms)', group: 'execution' },
    simSelfImpactEnabled: { label: 'Auto-impact', group: 'execution' },
    simSelfImpactTtlSeconds: { label: 'TTL auto-impact (s)', group: 'execution' },
    simWalletPreflightEnabled: { label: 'Préflight wallet', group: 'execution' },
    simShadowLoggingEnabled: { label: 'Shadow logging', group: 'execution' },
    shadowSampleRetentionDays: { label: 'Rétention shadow (j)', group: 'execution' },
    slConfirmationTicks: { label: 'Ticks confirmation SL', group: 'exit' },
  };

  return SIM_RISK_CONFIG_KEYS.map((key) => {
    const meta = labelByKey[key] ?? { label: key, group: 'other' as ConfigDiffGroup };
    if (key === 'simSizingMode') {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: (v) => formatSizing(v),
        normalize: (v) => formatSizing(v),
      };
    }
    if (key === 'simAllowedMarketTags') {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: formatTags,
        normalize: (v) => normalizePrimitive(Array.isArray(v) ? [...v].sort() : v),
      };
    }
    if (key === 'simSlEnabled') {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: (_v, c) => formatBool(isSnapshotSimSlEnabled(c)),
        normalize: simSlEnabledNormalize,
      };
    }
    if (key === 'simTpEnabled') {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: (_v, c) => formatBool(isSnapshotSimTpEnabled(c)),
        normalize: simTpEnabledNormalize,
      };
    }
    if (typeof key === 'string' && key.includes('Enabled')) {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: formatBool,
        normalize: (v) => normalizePrimitive(v),
      };
    }
    return {
      key,
      label: meta.label,
      group: meta.group,
      format: formatNumber,
      normalize: (v) => normalizePrimitive(v),
    };
  });
}

function buildRealFieldSpecs(): ConfigDiffFieldSpec[] {
  const labelByKey: Partial<Record<RealRiskConfigKey, { label: string; group: ConfigDiffGroup }>> = {
    realSizingMode: { label: 'Mode de sizing', group: 'entry' },
    realCopyRatio: { label: 'Ratio de copy', group: 'entry' },
    realEntryUsdcAmount: { label: 'Montant entrée (pUSD)', group: 'entry' },
    realEntryShareCount: { label: 'Parts à l\'entrée', group: 'entry' },
    realKellyFraction: { label: 'Fraction Kelly', group: 'entry' },
    realRiskBudgetUsdc: { label: 'Budget risque (pUSD)', group: 'entry' },
    realDefaultWinProbability: { label: 'Probabilité de gain par défaut', group: 'entry' },
    realMaxPositionSizeUsdc: { label: 'Taille max position', group: 'risk' },
    realMaxOpenPositions: { label: 'Max positions ouvertes', group: 'risk' },
    realMaxExposureUsdc: { label: 'Exposition max', group: 'risk' },
    realMaxDailyLossUsdc: { label: 'Perte journalière max', group: 'risk' },
    realKillSwitchAction: { label: 'Action kill switch', group: 'risk' },
    realAllowedMarketTags: { label: 'Tags marché autorisés', group: 'entry' },
    realSignalScoreSizingEnabled: { label: 'Sizing par score signal', group: 'entry' },
    realMinBidToAskRatio: { label: 'Ratio bid/ask min', group: 'entry' },
    realMomentumFilterEnabled: { label: 'Filtre momentum', group: 'entry' },
    realCopyIncreaseEnabled: { label: 'Copier augmentations', group: 'copy' },
    realCopyDecreaseEnabled: { label: 'Copier réductions', group: 'copy' },
    realMaxIncreasesPerPosition: { label: 'Max augmentations / position', group: 'copy' },
    realSlEnabled: { label: 'Stop-loss activé', group: 'exit' },
    realTpEnabled: { label: 'Take-profit activé', group: 'exit' },
    realSlPercent: { label: 'SL (% de la mise)', group: 'exit' },
    realSlCloseMaxRetries: { label: 'SL — max tentatives', group: 'exit' },
    realTpPercent: { label: 'TP (% de la mise)', group: 'exit' },
    realTrailingEnabled: { label: 'Trailing stop', group: 'exit' },
    realTrailingPercent: { label: 'Trailing (% de la mise)', group: 'exit' },
    realTrailingActivationPercent: { label: 'Activation trailing (% de la mise)', group: 'exit' },
    realPreCloseEnabled: { label: 'Pré-clôture', group: 'exit' },
    realPreCloseSeconds: { label: 'Pré-clôture (s)', group: 'exit' },
    realPreCloseKeepEnabled: { label: 'Pré-clôture Keep', group: 'exit' },
    realPreCloseKeepBidThreshold: { label: 'Seuil Keep bid', group: 'exit' },
    realMinTimeToClose: { label: 'Temps min avant clôture', group: 'exit' },
    realAutoSnapshotEnabled: { label: 'Snapshots auto', group: 'snapshots' },
    realAutoSnapshotIntervalSeconds: { label: 'Intervalle auto (s)', group: 'snapshots' },
    realSnapshotMaxCount: { label: 'Max snapshots', group: 'snapshots' },
    realSnapshotRetentionDays: { label: 'Rétention snapshots (j)', group: 'snapshots' },
    realSnapshotDecisionWindowHours: { label: 'Fenêtre journal décisions (h)', group: 'snapshots' },
    realCashOverride: { label: 'Override cash sizing (lecture seule)', group: 'entry' },
    slConfirmationTicks: { label: 'Ticks confirmation SL', group: 'exit' },
  };

  return REAL_RISK_CONFIG_KEYS.map((key) => {
    const meta = labelByKey[key] ?? { label: key, group: 'other' as ConfigDiffGroup };
    if (key === 'realSizingMode') {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: (v) => formatSizing(v),
        normalize: (v) => formatSizing(v),
      };
    }
    if (key === 'realAllowedMarketTags') {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: formatTags,
        normalize: (v) => normalizePrimitive(Array.isArray(v) ? [...v].sort() : v),
      };
    }
    if (typeof key === 'string' && key.includes('Enabled')) {
      return {
        key,
        label: meta.label,
        group: meta.group,
        format: formatBool,
        normalize: (v) => normalizePrimitive(v),
      };
    }
    return {
      key,
      label: meta.label,
      group: meta.group,
      format: formatNumber,
      normalize: (v) => normalizePrimitive(v),
    };
  });
}

const CRYPTO_ALGO_LABELS: Record<string, string> = {
  cryptoAlgoEnabled: 'Algo activé',
  cryptoAlgoPriceTickCleanupEnabled: 'Nettoyage ticks prix',
  cryptoAlgoPriceTickCleanupIntervalMinutes: 'Intervalle nettoyage (min)',
  cryptoAlgoStrategies: 'Stratégies',
  cryptoAlgoSlEnabled: 'Stop-loss activé',
  cryptoAlgoTpEnabled: 'Take-profit activé',
  cryptoAlgoTrailingEnabled: 'Trailing stop',
  cryptoAlgoSlPercent: 'SL (% de la mise)',
  cryptoAlgoTpPercent: 'TP (% de la mise)',
  cryptoAlgoTrailingPercent: 'Trailing (% de la mise)',
  cryptoAlgoTrailingActivationPercent: 'Activation trailing (% de la mise)',
  cryptoAlgoPreCloseEnabled: 'Pré-clôture',
  cryptoAlgoPreCloseSeconds: 'Pré-clôture (s)',
  cryptoAlgoPreCloseKeepEnabled: 'Pré-clôture Keep',
  cryptoAlgoPreCloseKeepBidThreshold: 'Seuil Keep bid',
  cryptoAlgoMinTimeToClose: 'Temps min avant clôture',
  cryptoAlgoReentryWindowMs: 'Fenêtre ré-entrée (ms)',
  cryptoAlgoMaxEntriesPerWindow: 'Max entrées / fenêtre',
  cryptoAlgoBaseThreshold: 'Seuil momentum (base)',
  cryptoAlgoEntryPriceMin: 'Prix entrée min',
  cryptoAlgoEntryPriceMax: 'Prix entrée max',
  cryptoAlgoEntryPriceBandEnabled: 'Bande de prix entrée',
  cryptoAlgoCurveFilterEnabled: 'Filtre courbe descendante',
  cryptoAlgoCurveLookbackMs: 'Fenêtre courbe (ms)',
  cryptoAlgoCurveMinDelta: 'Seuil descente courbe',
  cryptoAlgoSpreadAdjustmentFactor: 'Facteur ajustement spread',
  cryptoAlgoMinSpreadAbsForAdjustment: 'Spread min pour ajustement',
  cryptoAlgoMaxSpreadAbs: 'Spread max',
  cryptoAlgoPriceSumTolerance: 'Tolérance somme prix',
  cryptoAlgoWarnPriceDeviation: 'Alerte déviation prix',
  cryptoAlgoMaxBookAgeMs: 'Âge max carnet (ms)',
  cryptoAlgoGammaCacheTtlShortMs: 'TTL cache Gamma court (ms)',
  cryptoAlgoGammaCacheTtlDefaultMs: 'TTL cache Gamma défaut (ms)',
  cryptoAlgoGammaStaleOnErrorFactor: 'Facteur stale Gamma (erreur)',
  cryptoAlgoWsDebounceMs: 'Debounce WS (ms)',
  cryptoAlgoPollMs: 'Poll (ms)',
  cryptoAlgoTickIntervalMs: 'Intervalle tick (ms)',
  cryptoAlgoTickRetentionHours: 'Rétention ticks (h)',
  cryptoAlgoPriceTickRefQty: 'Qty ref tick prix',
  cryptoAlgoMinTimeToCloseBufferSeconds: 'Buffer temps min clôture (s)',
  cryptoAlgoLastCloseableBidMaxAgeMs: 'Âge max bid clôturable (ms)',
  cryptoAlgoSpreadAbsByInterval: 'Spread abs. par intervalle',
  cryptoAlgoExitDefaultsByInterval: 'Sorties par intervalle',
  cryptoAlgoPreCloseSecondsByInterval: 'Pré-clôture par intervalle',
  cryptoAlgoSlQuotaEnabled: 'Quota SL activé',
  cryptoAlgoSlQuotaPerMarket: 'Quota SL / marché',
  cryptoAlgoSlQuotaCacheTtlSeconds: 'TTL cache quota SL (s)',
  cryptoAlgoSizingMode: 'Mode de sizing crypto',
  cryptoAlgoEntryUsdcAmount: 'Montant entrée crypto (USDC)',
  cryptoAlgoEntryShareCount: 'Parts entrée crypto',
};

function buildCryptoAlgoFieldSpecs(): ConfigDiffFieldSpec[] {
  const jsonKeys = new Set([
    'cryptoAlgoSpreadAbsByInterval',
    'cryptoAlgoExitDefaultsByInterval',
    'cryptoAlgoPreCloseSecondsByInterval',
  ]);

  return (CRYPTO_ALGO_SNAPSHOT_KEYS as unknown as string[]).map((key) => {
    const label = CRYPTO_ALGO_LABELS[key] ?? key;
    if (key === 'cryptoAlgoStrategies') {
      return {
        key,
        label,
        group: 'crypto_algo' as ConfigDiffGroup,
        format: formatStrategies,
        normalize: normalizeStrategies,
      };
    }
    if (key === 'cryptoAlgoSizingMode') {
      return {
        key,
        label,
        group: 'crypto_algo' as ConfigDiffGroup,
        format: (v) => formatSizing(v),
        normalize: (v) => formatSizing(v),
      };
    }
    if (jsonKeys.has(key)) {
      return {
        key,
        label,
        group: 'crypto_algo',
        format: formatJsonCompact,
        normalize: normalizeJsonLike,
      };
    }
    if (key.includes('Enabled')) {
      return {
        key,
        label,
        group: 'crypto_algo',
        format: formatBool,
        normalize: (v) => normalizePrimitive(v),
      };
    }
    return {
      key,
      label,
      group: 'crypto_algo',
      format: formatNumber,
      normalize: (v) => normalizePrimitive(v),
    };
  });
}

export const SPECS_BY_MODE: Record<SnapshotConfigMode, ConfigDiffFieldSpec[]> = {
  sim: [...buildSimFieldSpecs(), ...buildCryptoAlgoFieldSpecs()],
  real: [...buildRealFieldSpecs(), ...buildCryptoAlgoFieldSpecs()],
};

export function configDiffGroupLabel(group: ConfigDiffGroup): string {
  return GROUP_LABELS[group];
}
