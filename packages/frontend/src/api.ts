const API_BASE = '/api';

/** Cache client pour réduire les doublons de requêtes GET rapprochées.
 * TTL différencié par type de données :
 * - 5s pour les données très dynamiques (positions, balance)
 * - 15s pour les données modérément dynamiques (risk-config, leaderboard)
 * - 30s pour les quasi-statiques (watchlist, market-tags, credentials, wallet)
 */
const CACHE_TTL_DYNAMIC = 5_000;
const CACHE_TTL_MODERATE = 15_000;
const CACHE_TTL_STATIC = 30_000;

const getCache = new Map<string, { value: unknown; expiresAt: number }>();
/** Promesses GET en cours pour la même URL. Évite de dupliquer une requête déjà partie. */
const pendingGetCache = new Map<string, Promise<unknown>>();

function shouldUseGetCache(path: string): boolean {
  // Time-sensitive algo data: always hit the network on each open/poll.
  return (
    !path.startsWith('/algo/markets-prices') &&
    !path.startsWith('/algo/market-chart') &&
    !path.startsWith('/market-chart') &&
    !path.startsWith('/sim-execution-stats') &&
    !path.startsWith('/algo/worker-queue-status') &&
    !path.startsWith('/system/overview') &&
    !path.startsWith('/system/crypto-algo-monitor') &&
    !path.startsWith('/weather-algo-discover')
  );
}

function getCacheTtl(path: string): number {
  if (
    path.startsWith('/copied-positions') ||
    path.startsWith('/simulation-balance') ||
    path.startsWith('/simulation-snapshots') ||
    path.startsWith('/real-snapshots') ||
    path.startsWith('/real-sessions') ||
    path.startsWith('/simulation/analytics') ||
    path.startsWith('/algo/optimize-report') ||
    path.startsWith('/reports') ||
    path.startsWith('/algo/surveillance-history') ||
    path.startsWith('/algo/worker-queue-status')
  ) {
    return CACHE_TTL_DYNAMIC;
  }
  if (
    path.startsWith('/config/global') ||
    path.startsWith('/config/copy') ||
    path.startsWith('/config/crypto') ||
    path.startsWith('/config/weather') ||
    path.startsWith('/risk-config') ||
    path.startsWith('/leaderboard')
  ) {
    return CACHE_TTL_MODERATE;
  }
  return CACHE_TTL_STATIC;
}

function getCacheKey(path: string): string {
  return path;
}

function getCached<T>(path: string): T | undefined {
  const entry = getCache.get(getCacheKey(path));
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value as T;
  }
  if (entry) getCache.delete(getCacheKey(path));
  return undefined;
}

function setCached<T>(path: string, value: T): void {
  const ttl = getCacheTtl(path);
  getCache.set(getCacheKey(path), { value, expiresAt: Date.now() + ttl });
}

/** Invalide les entrées de cache correspondant à un préfixe ou un pattern exact. */
function invalidateCache(pattern: string): void {
  for (const key of getCache.keys()) {
    if (key.startsWith(pattern)) {
      getCache.delete(key);
    }
  }
}

function clearCache(): void {
  getCache.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removePending(path: string): void {
  pendingGetCache.delete(getCacheKey(path));
}

type SessionExpiredListener = () => void;
let sessionExpiredListener: SessionExpiredListener | null = null;

let refreshPromise: Promise<boolean> | null = null;

// The short-lived access token lives in memory only: localStorage is
// readable by any injected script (XSS). The refresh token must survive
// page reloads, but it is single-use — a stolen copy is invalidated as
// soon as either party rotates it.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken');
}

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListener = listener;
  return () => {
    if (sessionExpiredListener === listener) {
      sessionExpiredListener = null;
    }
  };
}

function notifySessionExpired(): void {
  sessionExpiredListener?.();
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) {
    clearTokens();
    return false;
  }

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  });

  if (!res.ok) {
    clearTokens();
    return false;
  }

  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

async function ensureFreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Refresh JWT pair (shared by REST retry and Socket.IO reconnect). */
export function refreshSessionTokens(): Promise<boolean> {
  return ensureFreshAccessToken();
}

async function handleApiResponse<T>(
  path: string,
  options: RequestInit,
  res: Response,
  retried: boolean,
  retry429Count: number,
): Promise<T> {
  const isGet = options.method === undefined || options.method === 'GET';

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const body = err as { error?: string; message?: string };

    const canRefresh =
      res.status === 401 &&
      body.error === 'invalid_token' &&
      !retried &&
      !path.startsWith('/auth/');

    if (canRefresh) {
      const refreshed = await ensureFreshAccessToken();
      if (refreshed) return api<T>(path, options, true);
      notifySessionExpired();
      throw new Error('session_expired');
    }

    // Exponential backoff retry for 429 (up to 3 attempts).
    if (res.status === 429 && retry429Count < 3) {
      const backoff = Math.min(1_000 * 2 ** retry429Count, 8_000);
      const jitter = Math.random() * 500;
      await sleep(backoff + jitter);
      return api<T>(path, options, retried, retry429Count + 1);
    }

    if (body.message) throw new Error(`${body.error ?? 'request_failed'}:${body.message}`);
    throw new Error(body.error ?? 'request_failed');
  }

  // Invalidation ciblée du cache selon l'endpoint modifié.
  if (!isGet) {
    if (path.startsWith('/watchlist')) {
      invalidateCache('/watchlist');
    } else if (path.startsWith('/clob-credentials')) {
      invalidateCache('/clob-credentials');
    } else if (path.startsWith('/wallet')) {
      invalidateCache('/wallet');
    } else if (path.startsWith('/copied-positions')) {
      invalidateCache('/copied-positions');
      invalidateCache('/simulation-balance');
      invalidateCache('/wallet');
    } else if (
      path.startsWith('/config/global') ||
      path.startsWith('/config/copy') ||
      path.startsWith('/config/crypto') ||
      path.startsWith('/config/weather') ||
      path.startsWith('/risk-config')
    ) {
      invalidateCache('/config/global');
      invalidateCache('/config/copy');
      invalidateCache('/config/crypto');
      invalidateCache('/config/weather');
      invalidateCache('/risk-config');
      invalidateCache('/algo/optimize-report');
      invalidateCache('/reports');
    } else if (path.startsWith('/reports')) {
      invalidateCache('/reports');
    } else if (path.startsWith('/system-config')) {
      invalidateCache('/system-config');
    } else if (path.startsWith('/simulation-balance')) {
      invalidateCache('/simulation-balance');
      invalidateCache('/copied-positions');
      invalidateCache('/simulation-snapshots');
      // Reset persists the chosen amount into config tables.
      invalidateCache('/config/global');
      invalidateCache('/config/copy');
      invalidateCache('/config/crypto');
      invalidateCache('/config/weather');
      invalidateCache('/risk-config');
    } else if (path.startsWith('/simulation-snapshots')) {
      invalidateCache('/simulation-snapshots');
    } else if (path.startsWith('/real-snapshots')) {
      invalidateCache('/real-snapshots');
    } else if (path.startsWith('/real-sessions')) {
      invalidateCache('/real-sessions');
      invalidateCache('/real-snapshots');
      invalidateCache('/copied-positions');
      invalidateCache('/executions');
      invalidateCache('/wallet');
    } else if (path.startsWith('/move-events')) {
      invalidateCache('/move-events');
    } else if (path.startsWith('/e2e-runs')) {
      invalidateCache('/e2e-runs');
    } else {
      clearCache();
    }
  }

  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as T;
  if (isGet && shouldUseGetCache(path)) setCached(path, json);
  return json;
}

async function handleApiTextResponse(
  path: string,
  options: RequestInit,
  res: Response,
  retried: boolean,
): Promise<string> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const body = err as { error?: string; message?: string };

    const canRefresh =
      res.status === 401 &&
      body.error === 'invalid_token' &&
      !retried &&
      !path.startsWith('/auth/');

    if (canRefresh) {
      const refreshed = await ensureFreshAccessToken();
      if (refreshed) return apiText(path, options, true);
      notifySessionExpired();
      throw new Error('session_expired');
    }

    if (body.message) throw new Error(`${body.error ?? 'request_failed'}:${body.message}`);
    throw new Error(body.error ?? 'request_failed');
  }

  return res.text();
}

export async function apiText(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<string> {
  if (!accessToken && getRefreshToken() && !path.startsWith('/auth/')) {
    const refreshed = await ensureFreshAccessToken();
    if (!refreshed) {
      notifySessionExpired();
      throw new Error('session_expired');
    }
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  return handleApiTextResponse(path, options, res, retried);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
  retry429Count = 0,
): Promise<T> {
  // After a page reload the in-memory access token is gone — bootstrap a
  // fresh one from the persisted refresh token before the first call.
  if (!accessToken && getRefreshToken() && !path.startsWith('/auth/')) {
    const refreshed = await ensureFreshAccessToken();
    if (!refreshed) {
      notifySessionExpired();
      throw new Error('session_expired');
    }
  }

  // Short-lived client cache for GET to avoid duplicate rapid fetches.
  const isGet = options.method === undefined || options.method === 'GET';
  const cacheKey = getCacheKey(path);
  if (isGet && shouldUseGetCache(path)) {
    const cached = getCached<T>(path);
    if (cached !== undefined) return cached;

    const pending = pendingGetCache.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const requestPromise = (async (): Promise<T> => {
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      return await handleApiResponse<T>(path, options, res, retried, retry429Count);
    } finally {
      if (isGet) {
        removePending(path);
      }
    }
  })();

  if (isGet && shouldUseGetCache(path)) {
    pendingGetCache.set(cacheKey, requestPromise);
  }

  return requestPromise;
}

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  localStorage.setItem('refreshToken', refresh);
  // Legacy cleanup: the access token used to be persisted here.
  localStorage.removeItem('accessToken');
}

export function clearTokens(): void {
  accessToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function isLoggedIn(): boolean {
  return !!getRefreshToken();
}

// ─── Isolated config API functions ──────────────────────────────────

export interface GlobalConfig {
  maxSlippagePercent: number;
  exitSlippageGuardPercent: number;
  realTradingEnabled: boolean;
  realCashOverride: number | null;
  simExecLatencyMode: string | null;
  simExecLatencyMs: number | null;
  simSelfImpactEnabled: boolean | null;
  simSelfImpactTtlSeconds: number | null;
  simWalletPreflightEnabled: boolean | null;
  simShadowLoggingEnabled: boolean | null;
  shadowSampleRetentionDays: number | null;
  simAutoSnapshotEnabled: boolean;
  simAutoSnapshotIntervalSeconds: number;
  simSnapshotMaxCount: number | null;
  simSnapshotRetentionDays: number | null;
  simAutoSnapshotEmptySession: boolean;
  simSnapshotDecisionWindowHours: number;
  realAutoSnapshotEnabled: boolean;
  realAutoSnapshotIntervalSeconds: number;
  realSnapshotMaxCount: number | null;
  realSnapshotRetentionDays: number | null;
  realSnapshotDecisionWindowHours: number;
}

export interface CopyConfig {
  simMaxOpenPositions: number;
  realMaxOpenPositions: number;
  simMaxExposureUsdc: number;
  realMaxExposureUsdc: number;
  simMaxDailyLossUsdc: number;
  realMaxDailyLossUsdc: number;
  simMaxPositionSizeUsdc: number;
  realMaxPositionSizeUsdc: number;
  simMinBidToAskRatio: number;
  realMinBidToAskRatio: number;
  simMomentumFilterEnabled: boolean;
  realMomentumFilterEnabled: boolean;
  simCopyTradingEnabled: boolean;
  realCopyTradingEnabled: boolean;
  simSizingMode: string;
  simCopyRatio: number;
  simEntryUsdcAmount: number;
  simEntryShareCount: number;
  simKellyFraction: number;
  simRiskBudgetUsdc: number;
  simDefaultWinProbability: number;
  realSizingMode: string;
  realCopyRatio: number;
  realEntryUsdcAmount: number;
  realEntryShareCount: number;
  realKellyFraction: number;
  realRiskBudgetUsdc: number;
  realDefaultWinProbability: number;
  simTrailingEnabled: boolean;
  simTrailingBidPoints: number;
  simTrailingActivationBidPoints: number;
  realTrailingEnabled: boolean;
  realTrailingBidPoints: number;
  realTrailingActivationBidPoints: number;
  simSlEnabled: boolean;
  simTpEnabled: boolean;
  realSlEnabled: boolean;
  realTpEnabled: boolean;
  simSlBidPoints: number;
  simTpBidPoints: number;
  realSlBidPoints: number;
  realTpBidPoints: number;
  simSlCloseMaxRetries: number;
  realSlCloseMaxRetries: number;
  simEntryDepthRetryMax: number;
  simEntryDepthRetryDelayMs: number;
  realEntryDepthRetryMax: number;
  realEntryDepthRetryDelayMs: number;
  simKillSwitchAction: string;
  realKillSwitchAction: string;
  simCopyIncreaseEnabled: boolean;
  realCopyIncreaseEnabled: boolean;
  simCopyDecreaseEnabled: boolean;
  realCopyDecreaseEnabled: boolean;
  simMaxIncreasesPerPosition: number;
  realMaxIncreasesPerPosition: number;
  simCopyIncreaseSlProximityEnabled: boolean;
  realCopyIncreaseSlProximityEnabled: boolean;
  simCopyIncreaseSlProximityPercent: number;
  realCopyIncreaseSlProximityPercent: number;
  simPreCloseEnabled: boolean;
  realPreCloseEnabled: boolean;
  simPreCloseSeconds: number;
  realPreCloseSeconds: number;
  simMinTimeToClose: number;
  realMinTimeToClose: number;
  simPreCloseKeepEnabled: boolean;
  realPreCloseKeepEnabled: boolean;
  simPreCloseKeepBidThreshold: number;
  realPreCloseKeepBidThreshold: number;
  simAllowedMarketTags: string;
  realAllowedMarketTags: string;
  simSignalScoreSizingEnabled: boolean;
  realSignalScoreSizingEnabled: boolean;
  copyIncreaseEnabled: boolean;
  copyDecreaseEnabled: boolean;
  maxIncreasesPerPosition: number;
  preCloseEnabled: boolean;
  preCloseSeconds: number;
  killSwitchAction: string;
  slConfirmationTicks: number;
  moveDetectorIntervalMs: number;
  simInitialCapitalCopy: number;
  simCopyTradingEnabled: boolean;
  realCopyTradingEnabled: boolean;
}

export interface CryptoConfig {
  cryptoAlgoEnabled: boolean;
  cryptoAlgoMaxOpenPositions: number;
  cryptoAlgoMaxExposureUsdc: number;
  cryptoAlgoMaxDailyLossUsdc: number;
  cryptoAlgoMaxPositionSizeUsdc: number;
  cryptoAlgoSlConfirmationTicks: number;
  cryptoAlgoKillSwitchAction: string;
  cryptoAlgoMinBidToAskRatio: number;
  cryptoAlgoEntryDepthRetryMax: number;
  cryptoAlgoEntryDepthRetryDelayMs: number;
  cryptoAlgoSlCloseMaxRetries: number;
  cryptoAlgoMinTimeToClose: number | null;
  cryptoAlgoAllowedMarketTags: string[];
  cryptoAlgoSignalScoreSizingEnabled: boolean;
  cryptoAlgoPriceTickCleanupEnabled: boolean;
  cryptoAlgoPriceTickCleanupIntervalMinutes: number;
  cryptoAlgoStrategies: string[];
  cryptoAlgoTrailingBidPoints: number | null;
  cryptoAlgoTrailingActivationBidPoints: number | null;
  cryptoAlgoSlEnabled: boolean;
  cryptoAlgoTpEnabled: boolean;
  cryptoAlgoTrailingEnabled: boolean;
  cryptoAlgoSlBidPoints: number | null;
  cryptoAlgoTpBidPoints: number | null;
  cryptoAlgoPreCloseEnabled: boolean | null;
  cryptoAlgoPreCloseSeconds: number | null;
  cryptoAlgoPreCloseKeepEnabled: boolean | null;
  cryptoAlgoPreCloseKeepBidThreshold: number | null;
  cryptoAlgoReentryWindowMs: number | null;
  cryptoAlgoMaxEntriesPerWindow: number | null;
  cryptoAlgoBaseThreshold: number | null;
  cryptoAlgoEntryPriceMin: number | null;
  cryptoAlgoEntryPriceMax: number | null;
  cryptoAlgoEntryPriceBandEnabled: boolean | null;
  cryptoAlgoCurveFilterEnabled: boolean | null;
  cryptoAlgoCurveLookbackMs: number | null;
  cryptoAlgoCurveMinDelta: number | null;
  cryptoAlgoSpreadAdjustmentFactor: number | null;
  cryptoAlgoMinSpreadAbsForAdjustment: number | null;
  cryptoAlgoMaxSpreadAbs: number | null;
  cryptoAlgoPriceSumTolerance: number | null;
  cryptoAlgoWarnPriceDeviation: number | null;
  cryptoAlgoMaxBookAgeMs: number | null;
  cryptoAlgoGammaCacheTtlShortMs: number | null;
  cryptoAlgoGammaCacheTtlDefaultMs: number | null;
  cryptoAlgoGammaStaleOnErrorFactor: number | null;
  cryptoAlgoWsDebounceMs: number | null;
  cryptoAlgoPollMs: number | null;
  cryptoAlgoTickIntervalMs: number | null;
  cryptoAlgoTickRetentionHours: number | null;
  cryptoAlgoPriceTickRefQty: number | null;
  cryptoAlgoMinTimeToCloseBufferSeconds: number | null;
  cryptoAlgoLastCloseableBidMaxAgeMs: number | null;
  cryptoAlgoSpreadAbsByInterval: Record<string, number> | null;
  cryptoAlgoExitDefaultsByInterval: Record<
    string,
    {
      slBidPoints?: number;
      tpBidPoints?: number;
      trailingBidPoints?: number;
      trailingActivationBidPoints?: number;
    }
  > | null;
  cryptoAlgoPreCloseSecondsByInterval: Record<string, number> | null;
  cryptoAlgoSlQuotaEnabled: boolean;
  cryptoAlgoSlQuotaPerMarket: number;
  cryptoAlgoSlQuotaCacheTtlSeconds: number;
  cryptoAlgoSizingMode: string;
  cryptoAlgoEntryUsdcAmount: number;
  cryptoAlgoEntryShareCount: number | null;
  simInitialCapitalCrypto: number;
  cryptoAlgoConfigFingerprint?: string;
}

export interface WeatherConfig {
  weatherAlgoEnabled: boolean;
  weatherAlgoSimEnabled: boolean;
  weatherAlgoRealEnabled: boolean;
  weatherAlgoMinEdge: number;
  weatherAlgoMaxForecastStd: number | null;
  weatherAlgoSizingMode: string;
  weatherAlgoEntryUsdc: number;
  weatherAlgoSelectionMode: string;
  weatherAlgoMaxSignalsPerEvent: number;
  weatherAlgoForecastChangeThreshold: number;
  weatherAlgoCloseBeforeResolutionHours: number;
  weatherAlgoPollMs: number;
  weatherAlgoCityFollowSwitchMode: string;
  weatherAlgoBucketHysteresisPolls: number;
  weatherAlgoReentryThrottleMs: number;
  weatherAlgoMaxOpenPositions: number;
  weatherAlgoMaxExposureUsdc: number;
  weatherAlgoMaxDailyLossUsdc: number;
  weatherAlgoMaxPositionSizeUsdc: number;
  weatherAlgoSlConfirmationTicks: number;
  weatherAlgoKillSwitchAction: string;
  weatherAlgoMinBidToAskRatio: number;
  weatherAlgoEntryDepthRetryMax: number;
  weatherAlgoEntryDepthRetryDelayMs: number;
  weatherAlgoSlCloseMaxRetries: number;
  weatherAlgoMinTimeToClose: number;
  weatherAlgoAllowedMarketTags: string;
  weatherAlgoSignalScoreSizingEnabled: boolean;
  weatherAlgoPreCloseEnabled: boolean;
  weatherAlgoPreCloseSeconds: number;
  weatherAlgoSlEnabled: boolean;
  weatherAlgoTpEnabled: boolean;
  weatherAlgoTrailingEnabled: boolean;
  weatherAlgoSlBidPoints: number | null;
  weatherAlgoTpBidPoints: number | null;
  weatherAlgoTrailingBidPoints: number | null;
  weatherAlgoTrailingActivationBidPoints: number | null;
  simInitialCapitalWeather: number;
}

export async function fetchGlobalConfig(): Promise<GlobalConfig> {
  return api<GlobalConfig>('/config/global');
}

export async function updateGlobalConfig(data: Partial<GlobalConfig>): Promise<GlobalConfig> {
  return api<GlobalConfig>('/config/global', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchCopyConfig(): Promise<CopyConfig> {
  return api<CopyConfig>('/config/copy');
}

export async function updateCopyConfig(data: Partial<CopyConfig>): Promise<CopyConfig> {
  return api<CopyConfig>('/config/copy', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchCryptoConfig(): Promise<CryptoConfig> {
  return api<CryptoConfig>('/config/crypto');
}

export async function updateCryptoConfig(data: Partial<CryptoConfig>): Promise<CryptoConfig> {
  return api<CryptoConfig>('/config/crypto', { method: 'PUT', body: JSON.stringify(data) });
}

export async function fetchWeatherConfig(): Promise<WeatherConfig> {
  return api<WeatherConfig>('/config/weather');
}

export async function updateWeatherConfig(data: Partial<WeatherConfig>): Promise<WeatherConfig> {
  return api<WeatherConfig>('/config/weather', { method: 'PUT', body: JSON.stringify(data) });
}

/** Compose the legacy EnvSettings view from the four isolated config tables. */
export async function fetchEnvSettings(): Promise<EnvSettings> {
  const [globalConfig, copyConfig, cryptoConfig, weatherConfig] = await Promise.all([
    fetchGlobalConfig(),
    fetchCopyConfig(),
    fetchCryptoConfig(),
    fetchWeatherConfig(),
  ]);
  return {
    ...globalConfig,
    ...copyConfig,
    ...cryptoConfig,
    ...weatherConfig,
    simInitialCapital: cryptoConfig.simInitialCapitalCrypto,
  } as EnvSettings;
}

/**
 * Dispatch an EnvSettings patch to the correct /api/config/* endpoint(s)
 * based on the key prefixes. Returns the updated global config (legacy shape).
 */
export async function updateEnvSettings(
  patch: Partial<EnvSettings>,
): Promise<EnvSettings> {
  const globalPatch: Partial<GlobalConfig> = {};
  const copyPatch: Partial<CopyConfig> = {};
  const cryptoPatch: Partial<CryptoConfig> = {};
  const weatherPatch: Partial<WeatherConfig> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (key in globalConfigProxy || /^simAutoSnapshot|^realAutoSnapshot|^maxSlippagePercent|^realCashOverride|^simExec|^simSelfImpact|^simWalletPreflight|^simShadowLogging|^shadowSampleRetentionDays/.test(key)) {
      (globalPatch as Record<string, unknown>)[key] = value;
    } else if (key in copyConfigProxy || /^(sim|real)(Copy|Entry|Kelly|Risk|DefaultWin|Max|Min|Sl|Tp|Trailing|PreClose|AllowedMarketTags|SignalScore|Momentum|KillSwitch)|^slConfirmationTicks$|^moveDetectorIntervalMs$|^copyIncrease|^copyDecrease|^maxIncreases|^preCloseEnabled$|^preCloseSeconds$|^kill_switch|^simInitialCapitalCopy$/.test(key)) {
      (copyPatch as Record<string, unknown>)[key] = value;
    } else if (key in cryptoConfigProxy || /^cryptoAlgo|^simInitialCapitalCrypto$/.test(key) || key === 'simInitialCapital') {
      (cryptoPatch as Record<string, unknown>)[key] = value;
    } else if (key in weatherConfigProxy || /^weatherAlgo|^simInitialCapitalWeather$/.test(key)) {
      (weatherPatch as Record<string, unknown>)[key] = value;
    }
  }

  const promises: Promise<unknown>[] = [];
  if (Object.keys(globalPatch).length > 0) promises.push(updateGlobalConfig(globalPatch));
  if (Object.keys(copyPatch).length > 0) promises.push(updateCopyConfig(copyPatch));
  if (Object.keys(cryptoPatch).length > 0) promises.push(updateCryptoConfig(cryptoPatch));
  if (Object.keys(weatherPatch).length > 0) promises.push(updateWeatherConfig(weatherPatch));

  await Promise.all(promises);
  return fetchEnvSettings();
}

// Empty objects used only for `in` checks at runtime to decide which config
// table a key belongs to. TypeScript narrows these to their respective types.
const globalConfigProxy = {} as GlobalConfig;
const copyConfigProxy = {} as CopyConfig;
const cryptoConfigProxy = {} as CryptoConfig;
const weatherConfigProxy = {} as WeatherConfig;

