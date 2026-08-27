import {
  getStrategyParams,
  getWeatherStrategyMeta,
  parseWeatherAlgoStrategyParams,
  type BacktestRun,
  type StrategyParamSchema,
  type WeatherConfig,
  type WeatherStrategyParamsBag,
} from '@polywatch/core';

interface BacktestRunStrategyParamDto {
  key: string;
  label: string;
  hint?: string;
  display: string;
}

interface BacktestRunStrategyDto {
  id: string;
  label: string;
  description: string;
  params: BacktestRunStrategyParamDto[];
}

interface RunDto {
  id: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  progressPct: number;
  domain: string;
  mode: string;
  label: string | null;
  params: unknown;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  stats: unknown;
  fidelityWarnings: unknown;
  engineVersion: string | null;
  error: string | null;
  strategy: BacktestRunStrategyDto | null;
}

export function toRunDto(run: BacktestRun): RunDto {
  const params = safeParseJson(run.paramsJson);
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    status: run.status,
    progressPct: run.progressPct,
    domain: run.domain,
    mode: run.mode,
    label: run.label,
    params,
    dataRangeFrom: run.dataRangeFrom ? run.dataRangeFrom.toISOString() : null,
    dataRangeTo: run.dataRangeTo ? run.dataRangeTo.toISOString() : null,
    stats: safeParseJson(run.statsJson),
    fidelityWarnings: safeParseJson(run.fidelityWarningsJson),
    engineVersion: run.engineVersion,
    error: run.error,
    strategy: resolveBacktestRunStrategy(run, params),
  };
}

export function resolveBacktestRunStrategy(
  run: Pick<BacktestRun, 'configSnapshotJson'>,
  params: unknown,
): BacktestRunStrategyDto | null {
  const runParams =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const strategyId =
    typeof runParams.strategyId === 'string' && runParams.strategyId.length > 0
      ? runParams.strategyId
      : null;
  if (!strategyId && !run.configSnapshotJson) return null;

  const resolvedId = strategyId ?? 'weather-forecast';
  const meta = getWeatherStrategyMeta(resolvedId);
  const snapshot = safeParseJson(run.configSnapshotJson) as Partial<WeatherConfig> | null;
  const hasSnapshot =
    snapshot != null &&
    typeof snapshot === 'object' &&
    typeof snapshot.weatherAlgoStrategyParams === 'string';

  const rows: BacktestRunStrategyParamDto[] = [];
  if (hasSnapshot && meta) {
    const bag: WeatherStrategyParamsBag = {
      ...getStrategyParams(
        snapshot as Pick<WeatherConfig, 'weatherAlgoStrategyParams'>,
        resolvedId,
      ),
    };
    // Overrides du formulaire de lancement — ce sont les valeurs réellement
    // consommées par le runner (pas celles du bag snapshot seul).
    if (typeof runParams.entryUsdc === 'number' && Number.isFinite(runParams.entryUsdc)) {
      bag.entryUsdc = runParams.entryUsdc;
    }
    if (
      typeof runParams.maxConcurrentPositions === 'number' &&
      Number.isFinite(runParams.maxConcurrentPositions)
    ) {
      bag.maxOpenPositions = runParams.maxConcurrentPositions;
    }
    // Surcharge des params de stratégie (configOverrides.weatherAlgoStrategyParams,
    // string JSON) — fusionnée dans le bag affiché pour refléter la run réelle.
    const overrides = readStrategyParamsOverride(runParams);
    if (overrides) {
      Object.assign(bag, overrides);
    }
    for (const schema of meta.params) {
      const value = (bag as Record<string, unknown>)[schema.key];
      rows.push({
        key: schema.key,
        label: displayStrategyParamLabel(schema),
        hint: schema.hint,
        display: formatStrategyParamValue(schema, value),
      });
    }
  }

  return {
    id: resolvedId,
    label: meta?.label ?? resolvedId,
    description: meta?.description ?? '',
    params: rows,
  };
}

function displayStrategyParamLabel(schema: StrategyParamSchema): string {
  if (!isDurationMsParam(schema)) return schema.label;
  return schema.label.replace(/\s*\(ms\)\s*$/i, ' (min)');
}

/**
 * Lit l'override de params de stratégie envoyé via
 * `configOverrides.weatherAlgoStrategyParams` (string JSON) pour la stratégie
 * résolue. Retourne la partial bag fusionnée, ou null si absent.
 */
function readStrategyParamsOverride(
  runParams: Record<string, unknown>,
): Partial<WeatherStrategyParamsBag> | null {
  const overrides = runParams.configOverrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null;
  const raw = (overrides as Record<string, unknown>).weatherAlgoStrategyParams;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const parsed = parseWeatherAlgoStrategyParams(raw);
  const bag = parsed[runParams.strategyId as string];
  return bag && typeof bag === 'object' ? (bag as Partial<WeatherStrategyParamsBag>) : null;
}

export function formatStrategyParamValue(schema: StrategyParamSchema, raw: unknown): string {
  if (raw === null || raw === undefined) return 'Désactivé';
  if (schema.kind === 'boolean') return raw ? 'Oui' : 'Non';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return 'Toutes';
    return raw
      .map((v) => schema.options?.find((o) => o.value === String(v))?.label ?? String(v))
      .join(', ');
  }
  if (schema.kind === 'select' && typeof raw === 'string') {
    return schema.options?.find((o) => o.value === raw)?.label ?? raw;
  }
  if (typeof raw === 'number' && isDurationMsParam(schema)) {
    return formatMsAsMinutes(raw);
  }
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function isDurationMsParam(schema: StrategyParamSchema): boolean {
  return schema.key.endsWith('Ms');
}

function formatMsAsMinutes(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms === 0) return '0 min';
  const minutes = ms / 60_000;
  if (Number.isInteger(minutes)) return `${minutes} min`;
  const rounded = Math.round(minutes * 1000) / 1000;
  return `${rounded} min`;
}

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
