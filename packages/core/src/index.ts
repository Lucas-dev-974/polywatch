export * from './queue/worker-queues.js';
export {
  assertSecureSecret,
  canEnableRealTrading,
  INSECURE_DEFAULT_SECRETS,
  isInsecureSecret,
  isSecretSecurityBypassed,
  validateProductionSecrets,
  type AppSecrets,
} from './config/secrets.js';
export * from './types/index.js';
export type * from './types/sim-state-snapshot.js';
export { safeParseJson } from './types/sim-state-snapshot.js';
export type {
  ListSimSessionsOptions,
  SimSessionSummary,
  UpdateSimSessionOptions,
} from './types/sim-session.js';
export type {
  SimArchiveSummary,
  SimArchiveType,
  SimArchiveListOptions,
  SimArchiveListResult,
  SimArchivePositionDto,
  SimArchiveExecutionDto,
  SimArchiveExitAttemptDto,
  SimArchiveSurveillanceDto,
  SimArchiveCandleDto,
} from './types/sim-session-archive.js';
export type * from './types/real-state-snapshot.js';
export { safeParseJson as safeParseRealJson } from './types/real-state-snapshot.js';
export type {
  ListRealSessionsOptions,
  RealSessionSummary,
  UpdateRealSessionOptions,
} from './types/real-session.js';
export type {
  RealArchiveSummary,
  RealArchiveType,
  RealArchiveListOptions,
  RealArchiveListResult,
  RealArchivePositionDto,
  RealArchiveExecutionDto,
  RealArchiveExitAttemptDto,
} from './types/real-session-archive.js';
export type { SimulationSessionStatus } from './entities/SimulationSession.js';
export type { RealSessionStatus } from './entities/RealSession.js';
export type * from './types/trader-analytics.js';
export type * from './types/market-analytics.js';
export type * from './types/trader-insight.js';
export * from './entities/index.js';
export * from './database/data-source.js';
export { createTestDataSource } from './database/test-data-source.js';
export * from './pricing/vwap.js';
export * from './pricing/top-of-book.js';
export * from './pricing/fees.js';
export * from './idempotence/hash.js';
export * from './orders/close-signal.js';
export * from './orders/forced-exit.js';
export * from './orders/exit-emit-block.js';
export * from './orders/exit-attempt-mark.js';
export * from './sizing/constants.js';
export * from './sizing/compute.js';
export * from './sizing/entry-mos.js';
export * from './sizing/resolve-entry-mos.js';
export * from './sizing/apply-entry-mos-gate.js';
export * from './sizing/entry-sizing.js';
export * from './sizing/entry-depth-retry.js';
export * from './sizing/resume-reserved-entry.js';
export * from './sizing/enqueue-entry-signal.js';
export * from './sizing/gate-algo-entry-liquidity.js';
export * from './sizing/signal-scorer.js';
export { SignalScore, SignalScoreContext } from './sizing/signal-scorer.js';
export * from './sizing/real-cash.js';
export * from './risk/policy.js';
export * from './risk/exit-decision.js';
export * from './risk/risk-config-api.js';
export * from './risk/crypto-config-api.js';
export * from './risk/weather-config-api.js';
export * from './risk/sim-mode-fields.js';
export {
  resolveSimRotationTargets,
  resolveSimRotationTargetsFromConfigs,
  simRotationChanged,
  WEATHER_SESSION_ROTATION_KEYS,
} from './risk/sim-rotation-targets.js';
export {
  getSimInitialCapital,
  setSimInitialCapital,
} from './simulation/sim-initial-capital.js';
export * from './risk/crypto-algo-helpers.js';
export * from './risk/crypto-algo-exit.js';
export * from './risk/crypto-algo-tunables.js';
export * from './risk/crypto-algo-strategy-params.js';
export * from './risk/weather-exit-params.js';
export * from './risk/sim-execution-tunables.js';
export {
  detectRiskConfigDivergences,
  handleRiskConfigDivergence,
  RiskConfigDivergenceError,
  RiskConfigLegacyFacadeDisabledError,
} from './risk/risk-config-divergence.js';
export * from './market/tags.js';
export * from './market/leaderboard-categories.js';
export { createTtlCache } from './lib/ttl-cache.js';
export * from './positions/mark.js';
export * from './positions/outcome.js';
export * from './positions/redemption-wait.js';
export * from './positions/size.js';
export { resolveClosedExitBidVwap } from './positions/exit-bid.js';
export * from './market/lifecycle.js';
export { MarketType } from './market/market-type.js';
export { MarketClassifier, marketClassifier } from './market/classifier.js';
export {
  getMarketBehavior,
  shouldSyncPriceHistory,
  isCryptoUpDownMarket,
} from './market/behavior-registry.js';
export type { MarketBehavior } from './market/behavior-registry.js';
export * from './simulation/accounting.js';
export { algoKindFromReason, type SimAlgoKind } from './simulation/algo-kind.js';
export * from './simulation/algo-kind.js';
export {
  buildCryptoAlgoOptimizeReport,
  OPTIMIZE_REPORT_MIN_CLOSED,
} from './crypto-algo/optimize-report.js';
export {
  buildRecommendedCryptoAlgoConfig,
} from './crypto-algo/optimize-report-recommendations.js';
export { computeCryptoAlgoConfigFingerprint } from './crypto-algo/config-fingerprint.js';
export { loadCryptoAlgoOptimizeReport } from './crypto-algo/load-optimize-report-data.js';
export {
  compareCryptoAlgoOptimizeReports,
} from './crypto-algo/compare-reports.js';
export type {
  AnalysisReportDetail,
  AnalysisReportParams,
  AnalysisReportSummary,
  CompareAnalysisReportsResult,
  CompareReportMetricRow,
} from './crypto-algo/compare-reports.js';
export type { CryptoAlgoOptimizeReportFilters } from './crypto-algo/load-optimize-report-data.js';
export type {
  OptimizeReportRecommendedChange,
  OptimizeReportRecommendedConfig,
} from './crypto-algo/optimize-report-recommendations.js';
export type {
  BuildCryptoAlgoOptimizeReportInput,
  CryptoAlgoOptimizeReport,
  OptimizeReportAssetRow,
  OptimizeReportCloseReasonRow,
  OptimizeReportConfigInput,
  OptimizeReportEntryBucketRow,
  OptimizeReportExitAttemptRow,
  OptimizeReportLever,
  OptimizeReportPeakBucketRow,
  OptimizeReportPositionInput,
  OptimizeReportTickCoverageInput,
} from './crypto-algo/optimize-report.js';
export { DEFAULT_SIM_BALANCE } from './simulation/constants.js';
export { buildSimTraderRollup } from './simulation/trader-rollup.js';
export { buildRealTraderRollup } from './real/trader-rollup.js';
export {
  REAL_ROTATE_ADVISORY_LOCK_KEY,
  REAL_AUTO_SNAPSHOT_ADVISORY_LOCK_KEY,
  withRealRotateLock,
  withRealAutoSnapshotCreationLock,
} from './real/real-rotate-lock.js';
export { buildTraderAnalytics, aggregateTraderAnalyticsTotals, classifyCloseReason, positionInvestedAmount, positionHoldDurationMs } from './simulation/trader-analytics.js';
export { buildMarketAnalytics, aggregateMarketAnalyticsTotals } from './simulation/market-analytics.js';
export {
  buildMarketPnlSeriesFromSnapshots,
  buildMarketPnlSeriesResponse,
  sumMarketPnlFromPositions,
  MARKET_PNL_SERIES_HINTS,
} from './simulation/market-pnl-series.js';
export {
  buildTraderPnlSeriesFromSnapshots,
  buildTraderPnlSeriesResponse,
  appendLivePnlTerminalPoint,
  collectTraderMarkets,
  computeTraderPnlAtSnapshot,
  mergeTraderMarkets,
  sumTraderPnlFromPositions,
  updateLivePnlSeriesPoint,
  TRADER_PNL_SERIES_HINTS,
} from './simulation/trader-pnl-series.js';
export {
  MARKET_NAV_CATEGORY_LABELS,
  marketNavCategoryLabel,
  resolveMarketNavCategoryLabel,
  resolveMarketNavCategorySlug,
  resolvePrimaryNavTagSlug,
} from './market/nav-category.js';
export type { MarketNavCategorySlug } from './market/nav-category.js';
export {
  ANALYTICS_PNL_CATEGORY_LABELS,
  ANALYTICS_PNL_CATEGORY_SLUGS,
  buildPnlByMarketCategory,
  filterActiveMarketCategoryRows,
  resolveAnalyticsCategorySlug,
} from './simulation/pnl-by-category.js';
export type {
  AnalyticsPnlCategorySlug,
  MarketCategoryPnlRow,
} from './simulation/pnl-by-category.js';
export {
  buildActivitySummary,
  buildActivityTimeline,
  buildMarketBreakdown,
  buildRecentActivity,
  filterTradeActivities,
  regularityLabelFr,
  resolveRegularityLabel,
  TRADER_INSIGHT_ACTIVITY_PAGE_SIZE,
  TRADER_INSIGHT_MAX_ACTIVITY_PAGES,
  TRADER_INSIGHT_MAX_ACTIVITY_OFFSET,
} from './trader-insight/build-trader-insight.js';
export {
  buildTraderCapitalSeries,
  filterCapitalActivities,
} from './trader-insight/build-trader-capital-series.js';
export {
  buildTraderFundingAnalysis,
  buildFundingSummary,
  buildFundingTimeline,
  buildRecentFundingTransfers,
  classifyTokenTransfer,
  classifyTokenTransfers,
  resolveTraderFundingAddresses,
} from './trader-insight/build-trader-funding.js';
export type {
  ClassifiedFundingTransfer,
  FundingTransferDirection,
  TokenTransferInput,
} from './trader-insight/build-trader-funding.js';
export {
  COLLATERAL_TOKEN_DEFINITIONS,
  USDC_NATIVE_ADDRESS,
  buildPolymarketInternalContracts,
  collateralTokenSlugForAddress,
  isPolymarketOffRamp,
  isPolymarketOnRamp,
} from './polymarket/collateral-tokens.js';
export type {
  CollateralTokenDefinition,
  CollateralTokenSlug,
} from './polymarket/collateral-tokens.js';
export type {
  TraderInsightActivityInput,
  TraderInsightMarketMeta,
} from './trader-insight/build-trader-insight.js';
export type { TraderCapitalSeriesPoint } from './trader-insight/build-trader-capital-series.js';
export type {
  BuildTraderPnlSeriesOptions,
  BuildTraderPnlSeriesResponseOptions,
  TraderMarketOption,
  TraderPnlSeriesPoint,
  TraderPnlSeriesResponse,
  TraderPnlSeriesResult,
  TraderPnlSeriesSnapshotInput,
} from './simulation/trader-pnl-series.js';
export type {
  BuildMarketPnlSeriesOptions,
  BuildMarketPnlSeriesResponseOptions,
  MarketPnlSeriesResponse,
  MarketPnlSeriesResult,
  MarketPnlSeriesSnapshotInput,
} from './simulation/market-pnl-series.js';
export type {
  MarketAnalyticsRow,
  MarketAnalyticsTotals,
  MarketOutcomeBreakdown,
} from './types/market-analytics.js';
export * from './simulation/auto-snapshot-timing.js';
export * from './worker/move-detector-settings.js';
export * from './services/index.js';
export {
  discoverWeatherMarkets,
  groupMarketsByEvent,
  groupMarketsByCity,
  groupMarketsByCityAndDate,
  formatDiscoverCityLabel,
  formatDiscoverDateLabel,
  resolveMarketTargetDateIso,
  resolveGroupTargetDate,
  WEATHER_TAG_SLUG,
  type WeatherMarketDiscoveryResult,
  type CityMarketGroup,
  type DiscoverCityGroup,
  type DiscoverDateBucket,
  type ForecastEnrichedCityGroup,
  type ForecastEnrichedDateBucket,
  type ForecastStatus,
} from './weather/weather-market-discovery.js';
export { enrichCityGroupsWithForecast, type EnrichForecastOptions } from './weather/weather-forecast-enricher.js';
export { parseWeatherQuestion, resolveWeatherDate, type ParsedWeatherQuestion } from './weather/question-parser.js';
export {
  geocodeCity,
  fetchMultiModelForecast,
  fetchWeatherForecast,
  buildForecastFromModelResults,
  type GeocodingResult,
  type ModelForecast,
  type ForecastAggregation,
} from './weather/weather-api-client.js';
export {
  normalCDF,
  buildTempProbabilityDistribution,
  computeMarketImpliedProbabilities,
  computeCdfBelow,
  computeCdfAbove,
} from './weather/forecast-distribution.js';
export { calculateEdge, resolveDynamicMinEdge } from './weather/weather-edge.js';
export {
  shouldCloseForForecastDrift,
  shouldCloseBeforeResolution,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  isForecastInBucket,
  normalizeWeatherCity,
  buildLookAheadTargetDates,
  type BucketBounds,
  type WeatherCityFollowSwitchMode,
} from './weather/weather-exit-helpers.js';
export {
  selectForecastAlignedBucket,
  type BucketCandidate,
  type SelectedBucket,
} from './weather/forecast-bucket-selector.js';
export { seedDefaults } from './seed/defaults.js';
export { SYSTEM_CONFIG_DEFAULTS } from './seed/system-config-defaults.js';
export * from './polymarket/index.js';
export { createRedis } from './redis/factory.js';
export type { RedisConnectionConfig, RedisSentinelConfig } from './redis/factory.js';
export {
  ALGO_SL_QUOTA_INVALIDATE_CHANNEL,
  publishAlgoSlQuotaInvalidate,
  shouldInvalidateAlgoSlQuotaOnClose,
} from './redis/algo-sl-quota-invalidate.js';
export {
  ALGO_REENTRY_FILL_CHANNEL,
  publishAlgoReentryFill,
  shouldPublishAlgoReentryFill,
  type AlgoReentryFillPayload,
} from './redis/algo-reentry-fill.js';
export {
  ALGO_ENTRY_COOLDOWN_SECONDS,
  algoEntryCooldownKey,
  hasAlgoEntryCooldown,
  setAlgoEntryCooldown,
} from './redis/algo-entry-cooldown.js';
export {
  weatherReentryThrottleKey,
  setWeatherReentryThrottle,
  hasWeatherReentryThrottle,
} from './redis/weather-reentry-throttle.js';
export {
  cryptoReentryThrottleKey,
  normalizeCryptoReentryOutcome,
  parseCryptoReentryRedisState,
  loadCryptoReentryState,
  tryLoadCryptoReentryState,
  isCryptoReentrySuppressed,
  recordCryptoReentryFill,
  type CryptoReentryRedisState,
  type RecordCryptoReentryFillInput,
  type RecordCryptoReentryFillResult,
  type CryptoReentryLoadResult,
} from './redis/crypto-reentry-throttle.js';
export {
  weatherBucketHysteresisKey,
  incrementWeatherBucketHysteresis,
  resetWeatherBucketHysteresis,
  getWeatherBucketHysteresis,
} from './redis/weather-bucket-hysteresis.js';
export {
  ALGO_SELECTIONS_CHANGED_CHANNEL,
  publishAlgoSelectionsChanged,
  type AlgoSelectionsChangedPayload,
} from './redis/algo-selections-changed.js';
export {
  ENTRY_ENQUEUE_RETRY_COOLDOWN_SECONDS,
  ENTRY_ENQUEUE_MAX_RETRIES_PER_RESERVATION,
} from './sizing/entry-enqueue-retry.js';
export { resolveEntryEnqueueBlocked } from './sizing/entry-enqueue-result.js';
export {
  collectSimRedisPurgeHints,
  purgeSimExecutionRedisState,
  type SimRedisPurgeHints,
  type SimResetRedisPurgeResult,
} from './redis/sim-reset-redis-hygiene.js';
export {
  SIMULATION_RESET_CHANNEL,
  publishSimulationReset,
  parseSimulationResetPayload,
  type SimulationResetPayload,
} from './redis/simulation-reset.js';
export { safeInterval, sleep } from './worker-shared/safe-interval.js';
export { waitForBackendReady, parseBackendReadyPayload } from './worker-shared/backend-readiness.js';
export { createBackendClient, BACKEND_HTTP_TIMEOUT_MS } from './worker-shared/backend-client.js';
export type { BackendClientConfig } from './worker-shared/backend-client.js';
export { RedisQueue } from './worker-shared/redis-queue.js';
export type { DeadLetterNotifier, RedisQueueOptions } from './worker-shared/redis-queue.js';
export type {
  IPolymarketConnectionManager,
  IBookWsClient,
  ExecutablePriceResult,
} from './worker-shared/connection-manager-interface.js';
