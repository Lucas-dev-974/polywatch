import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  GlobalConfigService,
  CopyConfigService,
  CryptoConfigService,
  WeatherConfigService,
  RiskConfigRevisionService,
  RiskService,
  computeCryptoAlgoConfigFingerprint,
  canEnableRealTrading,
  resolveSimRotationTargetsFromConfigs,
  realRotationChangedFromIsolated,
  extractSimConfigSnapshot,
  extractRealConfigSnapshot,
  presentCryptoConfigForApi,
  toCryptoConfigEntityUpdate,
  presentWeatherConfigForApi,
  toWeatherConfigEntityUpdate,
  type GlobalConfig,
  type CopyConfig,
  type CryptoConfig,
  type WeatherConfig,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged } from '../redis.js';
import { SessionRotationService } from '../services/session-rotation.service.js';

// ─── Shared helpers ──────────────────────────────────────────────────

const nonNegNumber = z.number().finite().nonnegative();
const nonNegInt = z.number().int().nonnegative();
const bidToAskRatio = z.number().finite().min(0).max(1);
const sizingMode = z.enum([
  'fixed_ratio', 'fixed_usdc', 'fixed_shares',
  'proportional_capital', 'kelly_fractional', 'risk_based',
]);
const killSwitchAction = z.enum(['block_entries', 'force_close_all', 'block_and_notify']);

// ─── Global config schema ────────────────────────────────────────────

const globalConfigUpdateSchema = z.object({
  maxSlippagePercent: nonNegNumber,
  exitSlippageGuardPercent: nonNegNumber,
  realTradingEnabled: z.boolean(),
  realCashOverride: nonNegNumber.nullable(),
  simExecLatencyMode: z.enum(['fixed', 'calibrated']).nullable(),
  simExecLatencyMs: nonNegInt.nullable(),
  simSelfImpactEnabled: z.boolean().nullable(),
  simSelfImpactTtlSeconds: nonNegInt.nullable(),
  simWalletPreflightEnabled: z.boolean().nullable(),
  simShadowLoggingEnabled: z.boolean().nullable(),
  shadowSampleRetentionDays: nonNegInt.nullable(),
  simAutoSnapshotEnabled: z.boolean(),
  simAutoSnapshotIntervalSeconds: nonNegInt,
  simSnapshotMaxCount: nonNegInt.nullable(),
  simSnapshotRetentionDays: nonNegInt.nullable(),
  simAutoSnapshotEmptySession: z.boolean(),
  simSnapshotDecisionWindowHours: z.number().int().min(1).max(168),
  realAutoSnapshotEnabled: z.boolean(),
  realAutoSnapshotIntervalSeconds: nonNegInt,
  realSnapshotMaxCount: nonNegInt.nullable(),
  realSnapshotRetentionDays: nonNegInt.nullable(),
  realSnapshotDecisionWindowHours: z.number().int().min(1).max(168),
}).partial().strict();

// ─── Copy config schema ──────────────────────────────────────────────

const copyConfigUpdateSchema = z.object({
  simMaxOpenPositions: nonNegInt,
  realMaxOpenPositions: nonNegInt,
  simMaxExposureUsdc: nonNegNumber,
  realMaxExposureUsdc: nonNegNumber,
  simMaxDailyLossUsdc: nonNegNumber,
  realMaxDailyLossUsdc: nonNegNumber,
  simMaxPositionSizeUsdc: nonNegNumber,
  realMaxPositionSizeUsdc: nonNegNumber,
  simMinBidToAskRatio: bidToAskRatio,
  realMinBidToAskRatio: bidToAskRatio,
  simMomentumFilterEnabled: z.boolean(),
  realMomentumFilterEnabled: z.boolean(),
  simCopyTradingEnabled: z.boolean(),
  realCopyTradingEnabled: z.boolean(),
  simSizingMode: sizingMode,
  simCopyRatio: nonNegNumber,
  simEntryUsdcAmount: nonNegNumber,
  simEntryShareCount: z.number().int().min(1),
  simKellyFraction: nonNegNumber,
  simRiskBudgetUsdc: nonNegNumber,
  simDefaultWinProbability: z.number().finite().min(0).max(1),
  realSizingMode: sizingMode,
  realCopyRatio: nonNegNumber,
  realEntryUsdcAmount: nonNegNumber,
  realEntryShareCount: z.number().int().min(1),
  realKellyFraction: nonNegNumber,
  realRiskBudgetUsdc: nonNegNumber,
  realDefaultWinProbability: z.number().finite().min(0).max(1),
  simTrailingEnabled: z.boolean(),
  simTrailingBidPoints: z.number().finite().min(0).max(1),
  simTrailingActivationBidPoints: z.number().finite().min(0).max(1),
  realTrailingEnabled: z.boolean(),
  realTrailingBidPoints: z.number().finite().min(0).max(1),
  realTrailingActivationBidPoints: z.number().finite().min(0).max(1),
  simSlEnabled: z.boolean(),
  simTpEnabled: z.boolean(),
  realSlEnabled: z.boolean(),
  realTpEnabled: z.boolean(),
  simSlBidPoints: z.number().finite().min(0).max(1),
  simTpBidPoints: z.number().finite().min(0).max(1),
  realSlBidPoints: z.number().finite().min(0).max(1),
  realTpBidPoints: z.number().finite().min(0).max(1),
  simSlCloseMaxRetries: nonNegInt,
  realSlCloseMaxRetries: nonNegInt,
  simEntryDepthRetryMax: nonNegInt,
  simEntryDepthRetryDelayMs: nonNegInt,
  realEntryDepthRetryMax: nonNegInt,
  realEntryDepthRetryDelayMs: nonNegInt,
  simKillSwitchAction: killSwitchAction,
  realKillSwitchAction: killSwitchAction,
  simCopyIncreaseEnabled: z.boolean(),
  realCopyIncreaseEnabled: z.boolean(),
  simCopyDecreaseEnabled: z.boolean(),
  realCopyDecreaseEnabled: z.boolean(),
  simMaxIncreasesPerPosition: nonNegInt,
  realMaxIncreasesPerPosition: nonNegInt,
  simCopyIncreaseSlProximityEnabled: z.boolean(),
  realCopyIncreaseSlProximityEnabled: z.boolean(),
  simCopyIncreaseSlProximityPercent: z.number().finite().min(0).max(100),
  realCopyIncreaseSlProximityPercent: z.number().finite().min(0).max(100),
  simPreCloseEnabled: z.boolean(),
  realPreCloseEnabled: z.boolean(),
  simPreCloseSeconds: nonNegInt,
  realPreCloseSeconds: nonNegInt,
  simMinTimeToClose: nonNegInt,
  realMinTimeToClose: nonNegInt,
  simPreCloseKeepEnabled: z.boolean(),
  realPreCloseKeepEnabled: z.boolean(),
  simPreCloseKeepBidThreshold: z.number().finite().min(0).max(1),
  realPreCloseKeepBidThreshold: z.number().finite().min(0).max(1),
  simAllowedMarketTags: z.array(z.string().min(1).max(100)).max(200),
  realAllowedMarketTags: z.array(z.string().min(1).max(100)).max(200),
  simSignalScoreSizingEnabled: z.boolean(),
  realSignalScoreSizingEnabled: z.boolean(),
  copyIncreaseEnabled: z.boolean(),
  copyDecreaseEnabled: z.boolean(),
  maxIncreasesPerPosition: nonNegInt,
  preCloseEnabled: z.boolean(),
  preCloseSeconds: nonNegInt,
  killSwitchAction,
  slConfirmationTicks: z.number().int().min(1).max(10),
  moveDetectorIntervalMs: nonNegInt,
  simInitialCapitalCopy: nonNegNumber,
}).partial().strict();

// ─── Crypto config schema ────────────────────────────────────────────

const cryptoAlgoIntervalKey = z.enum(['5m', '10m', '15m', '30m', '1h', '4h', '1d']);
const cryptoAlgoIntervalNumberMap = z.record(cryptoAlgoIntervalKey, z.number().finite()).nullable();
const cryptoAlgoIntervalSecondsMap = z.record(cryptoAlgoIntervalKey, z.number().int().min(0).max(3600)).nullable();
const cryptoAlgoExitDefaultsMap = z.record(cryptoAlgoIntervalKey, z.object({
  slBidPoints: z.number().finite().min(0).max(1).optional(),
  tpBidPoints: z.number().finite().min(0).max(1).optional(),
  trailingBidPoints: z.number().finite().min(0).max(1).optional(),
  trailingActivationBidPoints: z.number().finite().min(0).max(1).optional(),
}).strict()).nullable();

const cryptoConfigUpdateSchema = z.object({
  cryptoAlgoEnabled: z.boolean(),
  cryptoAlgoMaxOpenPositions: nonNegInt,
  cryptoAlgoMaxExposureUsdc: nonNegNumber,
  cryptoAlgoMaxDailyLossUsdc: nonNegNumber,
  cryptoAlgoMaxPositionSizeUsdc: nonNegNumber,
  cryptoAlgoSlConfirmationTicks: z.number().int().min(1).max(10),
  cryptoAlgoKillSwitchAction: killSwitchAction,
  cryptoAlgoMinBidToAskRatio: bidToAskRatio,
  cryptoAlgoEntryDepthRetryMax: nonNegInt,
  cryptoAlgoEntryDepthRetryDelayMs: nonNegInt,
  cryptoAlgoSlCloseMaxRetries: nonNegInt,
  cryptoAlgoAllowedMarketTags: z.array(z.string().min(1).max(100)).max(200),
  cryptoAlgoSignalScoreSizingEnabled: z.boolean(),
  cryptoAlgoPriceTickCleanupEnabled: z.boolean(),
  cryptoAlgoPriceTickCleanupIntervalMinutes: z.number().int().min(1).max(1440),
  cryptoAlgoStrategies: z.array(z.string().min(1)).max(20),
  cryptoAlgoTrailingBidPoints: z.number().finite().min(0).max(1).nullable(),
  cryptoAlgoTrailingActivationBidPoints: z.number().finite().min(0).max(1).nullable(),
  cryptoAlgoSlEnabled: z.boolean(),
  cryptoAlgoTpEnabled: z.boolean(),
  cryptoAlgoTrailingEnabled: z.boolean(),
  cryptoAlgoSlBidPoints: z.number().min(0).max(1).nullable(),
  cryptoAlgoTpBidPoints: z.number().min(0).max(1).nullable(),
  cryptoAlgoPreCloseEnabled: z.boolean().nullable(),
  cryptoAlgoPreCloseSeconds: nonNegInt.nullable(),
  cryptoAlgoPreCloseKeepEnabled: z.boolean().nullable(),
  cryptoAlgoPreCloseKeepBidThreshold: z.number().finite().min(0).max(1).nullable(),
  cryptoAlgoMinTimeToClose: nonNegInt.nullable(),
  cryptoAlgoReentryWindowMs: z.number().int().min(1).max(86_400_000).nullable(),
  cryptoAlgoMaxEntriesPerWindow: z.number().int().min(1).max(20).nullable(),
  cryptoAlgoBaseThreshold: z.number().finite().min(0.5).max(0.99).nullable(),
  cryptoAlgoEntryPriceMin: z.number().finite().min(0.01).max(0.98).nullable(),
  cryptoAlgoEntryPriceMax: z.number().finite().min(0.02).max(0.99).nullable(),
  cryptoAlgoEntryPriceBandEnabled: z.boolean().nullable(),
  cryptoAlgoCurveFilterEnabled: z.boolean().nullable(),
  cryptoAlgoCurveLookbackMs: z.number().int().min(1000).max(60_000).nullable(),
  cryptoAlgoCurveMinDelta: z.number().finite().min(0.001).max(0.2).nullable(),
  cryptoAlgoSpreadAdjustmentFactor: z.number().finite().min(0).max(5).nullable(),
  cryptoAlgoMinSpreadAbsForAdjustment: z.number().finite().min(0).max(0.5).nullable(),
  cryptoAlgoMaxSpreadAbs: z.number().finite().min(0.001).max(0.5).nullable(),
  cryptoAlgoPriceSumTolerance: z.number().finite().min(0.001).max(0.2).nullable(),
  cryptoAlgoWarnPriceDeviation: z.number().finite().min(0.01).max(0.5).nullable(),
  cryptoAlgoMaxBookAgeMs: z.number().int().min(1000).max(300_000).nullable(),
  cryptoAlgoGammaCacheTtlShortMs: z.number().int().min(1000).max(300_000).nullable(),
  cryptoAlgoGammaCacheTtlDefaultMs: z.number().int().min(1000).max(600_000).nullable(),
  cryptoAlgoGammaStaleOnErrorFactor: z.number().finite().min(1).max(10).nullable(),
  cryptoAlgoWsDebounceMs: z.number().int().min(0).max(60_000).nullable(),
  cryptoAlgoPollMs: z.number().int().min(1000).max(600_000).nullable(),
  cryptoAlgoTickIntervalMs: z.number().int().min(100).max(60_000).nullable(),
  cryptoAlgoTickRetentionHours: z.number().int().min(1).max(720).nullable(),
  cryptoAlgoPriceTickRefQty: z.number().finite().min(1).max(10_000).nullable(),
  cryptoAlgoMinTimeToCloseBufferSeconds: z.number().int().min(0).max(600).nullable(),
  cryptoAlgoLastCloseableBidMaxAgeMs: z.number().int().min(1000).max(600_000).nullable(),
  cryptoAlgoSizingMode: z.enum(['fixed_usdc', 'fixed_shares']).optional(),
  cryptoAlgoEntryUsdcAmount: z.number().finite().min(1).max(100000).optional(),
  cryptoAlgoEntryShareCount: z.number().finite().min(1).max(1000000).optional(),
  cryptoAlgoSlQuotaEnabled: z.boolean(),
  cryptoAlgoSlQuotaPerMarket: z.number().int().min(1).max(20),
  cryptoAlgoSlQuotaCacheTtlSeconds: z.number().int().min(5).max(600),
  cryptoAlgoSpreadAbsByInterval: cryptoAlgoIntervalNumberMap,
  cryptoAlgoExitDefaultsByInterval: cryptoAlgoExitDefaultsMap,
  cryptoAlgoPreCloseSecondsByInterval: cryptoAlgoIntervalSecondsMap,
  simInitialCapitalCrypto: nonNegNumber,
}).partial().strict();

// ─── Weather config schema ───────────────────────────────────────────

const weatherSelectionMode = z.enum(['single', 'multi']);

const weatherConfigUpdateSchema = z.object({
  weatherAlgoMaxOpenPositions: nonNegInt,
  weatherAlgoMaxExposureUsdc: nonNegNumber,
  weatherAlgoMaxDailyLossUsdc: nonNegNumber,
  weatherAlgoMaxPositionSizeUsdc: nonNegNumber,
  weatherAlgoSlConfirmationTicks: z.number().int().min(1).max(10),
  weatherAlgoKillSwitchAction: killSwitchAction,
  weatherAlgoMinBidToAskRatio: bidToAskRatio,
  weatherAlgoEntryDepthRetryMax: nonNegInt,
  weatherAlgoEntryDepthRetryDelayMs: nonNegInt,
  weatherAlgoSlCloseMaxRetries: nonNegInt,
  weatherAlgoMinTimeToClose: nonNegInt,
  weatherAlgoAllowedMarketTags: z.array(z.string().min(1).max(100)).max(200),
  weatherAlgoSignalScoreSizingEnabled: z.boolean(),
  weatherAlgoPreCloseEnabled: z.boolean(),
  weatherAlgoPreCloseSeconds: nonNegInt,
  weatherAlgoSlEnabled: z.boolean(),
  weatherAlgoTpEnabled: z.boolean(),
  weatherAlgoTrailingEnabled: z.boolean(),
  weatherAlgoSlBidPoints: z.number().finite().min(0).max(1).nullable(),
  weatherAlgoTpBidPoints: z.number().finite().min(0).max(1).nullable(),
  weatherAlgoTrailingBidPoints: z.number().finite().min(0).max(1).nullable(),
  weatherAlgoTrailingActivationBidPoints: z.number().finite().min(0).max(1).nullable(),
  weatherAlgoEnabled: z.boolean(),
  weatherAlgoSimEnabled: z.boolean(),
  weatherAlgoRealEnabled: z.boolean(),
  weatherAlgoMinEdge: z.number().finite().min(0.01).max(0.50),
  weatherAlgoMaxForecastStd: z.number().finite().min(0).max(20).nullable(),
  weatherAlgoSizingMode: z.enum(['fixed_usdc']),
  weatherAlgoEntryUsdc: z.number().finite().min(1).max(10000),
  weatherAlgoSelectionMode: weatherSelectionMode,
  weatherAlgoMaxSignalsPerEvent: z.number().int().min(1).max(20),
  weatherAlgoForecastChangeThreshold: z.number().finite().min(0.5).max(20),
  weatherAlgoCloseBeforeResolutionHours: z.number().finite().min(0.5).max(168),
  weatherAlgoPollMs: z.number().int().min(10_000).max(86_400_000),
  weatherAlgoCityFollowSwitchMode: z.enum(['close_and_reenter', 'hold']),
  weatherAlgoBucketHysteresisPolls: z.number().int().min(1).max(10),
  weatherAlgoReentryThrottleMs: z.number().int().min(0).max(86_400_000),
  simInitialCapitalWeather: nonNegNumber,
}).partial().strict();

// ─── Router factory ──────────────────────────────────────────────────

export function createConfigPerKindRouter(ds: DataSource): Router {
  const router = Router();
  const globalService = new GlobalConfigService(ds);
  const copyService = new CopyConfigService(ds);
  const cryptoService = new CryptoConfigService(ds);
  const weatherService = new WeatherConfigService(ds);
  const revisionService = new RiskConfigRevisionService(ds);
  const rotationService = new SessionRotationService(ds);

  async function loadAllConfigs(): Promise<{ global: GlobalConfig; copy: CopyConfig; crypto: CryptoConfig; weather: WeatherConfig }> {
    const [global, copy, crypto, weather] = await Promise.all([
      globalService.getConfig(),
      copyService.getConfig(),
      cryptoService.getConfig(),
      weatherService.getConfig(),
    ]);
    return { global, copy, crypto, weather };
  }

  async function handleConfigRotation(
    before: { global: GlobalConfig; copy: CopyConfig; crypto: CryptoConfig; weather: WeatherConfig },
    after: { global: GlobalConfig; copy: CopyConfig; crypto: CryptoConfig; weather: WeatherConfig },
  ): Promise<{ simTargets: string[]; realRotated: boolean }> {
    const simTargets = resolveSimRotationTargetsFromConfigs(before, after);
    const realRotated = realRotationChangedFromIsolated(before, after);

    if (simTargets.length > 0 || realRotated) {
      await rotationService.rotateOnConfigChange(before, after);
    }
    return { simTargets, realRotated };
  }

  // ─── /api/config/global ──────────────────────────────────────────────

  router.get('/config/global', requireJwt, async (_req, res) => {
    const config = await globalService.getConfig();
    res.json(config);
  });

  router.put('/config/global', requireJwt, async (req, res) => {
    const parsed = globalConfigUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    try {
      const before = await loadAllConfigs();
      const updated = await globalService.updateConfig(parsed.data as any);
      RiskService.invalidateConfigCache();
      const after = await loadAllConfigs();
      const rotation = await handleConfigRotation(before, after);
      await revisionService.recordRevision(updated, { source: 'api', patch: parsed.data, kind: 'global' });
      await publishConfigChanged('global');
      res.json({ ...updated, sessionRotation: rotation });
    } catch (e) {
      if ((e as Error).message === 'insecure_secrets_real_trading_blocked') {
        res.status(403).json({ error: 'insecure_secrets_real_trading_blocked', message: 'Generate unique secrets first.' });
        return;
      }
      throw e;
    }
  });

  // ─── /api/config/copy ────────────────────────────────────────────────

  router.get('/config/copy', requireJwt, async (_req, res) => {
    const config = await copyService.getConfig();
    res.json(config);
  });

  router.put('/config/copy', requireJwt, async (req, res) => {
    const parsed = copyConfigUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    const before = await loadAllConfigs();
    const updated = await copyService.updateConfig(parsed.data as any);
    RiskService.invalidateConfigCache();
    const after = await loadAllConfigs();
    const rotation = await handleConfigRotation(before, after);
    await revisionService.recordRevision(updated, { source: 'api', patch: parsed.data, kind: 'copy' });
    await publishConfigChanged('copy');
    res.json({ ...updated, sessionRotation: rotation });
  });

  // ─── /api/config/crypto ──────────────────────────────────────────────

  router.get('/config/crypto', requireJwt, async (_req, res) => {
    const config = await cryptoService.getConfig();
    res.json({
      ...presentCryptoConfigForApi(config),
      cryptoAlgoConfigFingerprint: computeCryptoAlgoConfigFingerprint(config),
    });
  });

  router.put('/config/crypto', requireJwt, async (req, res) => {
    const raw = req.body as Record<string, unknown>;
    const expectedFingerprint = typeof raw.expectedCryptoAlgoConfigFingerprint === 'string'
      ? raw.expectedCryptoAlgoConfigFingerprint : undefined;
    const { expectedCryptoAlgoConfigFingerprint: _fp, revisionSource: _rs, ...configBody } = raw;
    const parsed = cryptoConfigUpdateSchema.safeParse(configBody);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    if (expectedFingerprint) {
      const current = await cryptoService.getConfig();
      const currentFingerprint = computeCryptoAlgoConfigFingerprint(current);
      if (currentFingerprint !== expectedFingerprint) {
        res.status(409).json({
          error: 'config_fingerprint_mismatch',
          message: 'La config live a changé depuis la génération du rapport. Régénérez le rapport avant d\'appliquer.',
          currentFingerprint,
        });
        return;
      }
    }
    const revisionSource = typeof raw.revisionSource === 'string' &&
      (raw.revisionSource === 'api' || raw.revisionSource === 'report_apply' || raw.revisionSource === 'system')
      ? raw.revisionSource : 'api';
    const before = await loadAllConfigs();
    const updated = await cryptoService.updateConfig(
      toCryptoConfigEntityUpdate(parsed.data),
    );
    RiskService.invalidateConfigCache();
    const after = await loadAllConfigs();
    const rotation = await handleConfigRotation(before, after);
    await revisionService.recordRevision(updated, { source: revisionSource, patch: parsed.data, kind: 'crypto' });
    await publishConfigChanged('crypto');
    res.json({
      ...presentCryptoConfigForApi(updated),
      cryptoAlgoConfigFingerprint: computeCryptoAlgoConfigFingerprint(updated),
      sessionRotation: rotation,
    });
  });

  // ─── /api/config/weather ─────────────────────────────────────────────

  router.get('/config/weather', requireJwt, async (_req, res) => {
    const config = await weatherService.getConfig();
    res.json(presentWeatherConfigForApi(config));
  });

  router.put('/config/weather', requireJwt, async (req, res) => {
    const parsed = weatherConfigUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    const before = await loadAllConfigs();
    const updated = await weatherService.updateConfig(
      toWeatherConfigEntityUpdate(parsed.data),
    );
    RiskService.invalidateConfigCache();
    const after = await loadAllConfigs();
    const rotation = await handleConfigRotation(before, after);
    await revisionService.recordRevision(updated, { source: 'api', patch: parsed.data, kind: 'weather' });
    await publishConfigChanged('weather');
    res.json({ ...presentWeatherConfigForApi(updated), sessionRotation: rotation });
  });

  return router;
}
