import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  ClobCredentials,
  RiskService,
  GlobalConfigService,
  CryptoConfigService,
  RiskConfigRevisionService,
  computeCryptoAlgoConfigFingerprint,
  presentRiskConfigForApi,
  toRiskConfigEntityUpdate,
  validateCryptoAlgoTunablesUpdate,
  fetchSimExecutionStats,
  MIN_MOVE_DETECTOR_INTERVAL_MS,
  MAX_MOVE_DETECTOR_INTERVAL_MS,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import {
  emptyableEthAddressSchema,
  ethAddressSchema,
} from '../validation/eth-address.js';
import { encrypt } from '../crypto/encryption.js';
import { publishConfigChanged } from '../redis.js';
import { evaluateStoredClobReadiness } from '../polymarket/clob-readiness.js';
import {
  clearStoredPolygonscanApiKey,
  getPolygonscanSettingsStatus,
  savePolygonscanApiKey,
} from '../polymarket/polygonscan-settings.js';
import { clearTraderFundingCache } from '../polymarket/trader-funding-fetcher.js';
import { SessionRotationService } from '../services/session-rotation.service.js';

const nonNegNumber = z.number().finite().nonnegative();
const nonNegInt = z.number().int().nonnegative();
const bidToAskRatio = z.number().finite().min(0).max(1);
const sizingMode = z.enum([
  'fixed_ratio',
  'fixed_usdc',
  'fixed_shares',
  'proportional_capital',
  'kelly_fractional',
  'risk_based',
]);
const entryShareCount = z.number().int().min(1);
const killSwitchAction = z.enum([
  'block_entries',
  'force_close_all',
  'block_and_notify',
]);
const cryptoAlgoIntervalKey = z.enum(['5m', '10m', '15m', '30m', '1h', '4h', '1d']);
const cryptoAlgoIntervalNumberMap = z
  .record(cryptoAlgoIntervalKey, z.number().finite())
  .nullable();
/** Pre-close / time-exit seconds maps — integers only. */
const cryptoAlgoIntervalSecondsMap = z
  .record(cryptoAlgoIntervalKey, z.number().int().min(0).max(3600))
  .nullable();
const cryptoAlgoExitDefaultsMap = z
  .record(
    cryptoAlgoIntervalKey,
    z
      .object({
        slBidPoints: z.number().finite().min(0).max(1).optional(),
        tpBidPoints: z.number().finite().min(0).max(1).optional(),
        trailingBidPoints: z.number().finite().min(0).max(1).optional(),
        trailingActivationBidPoints: z.number().finite().min(0).max(1).optional(),
      })
      .strict(),
  )
  .nullable();

/**
 * Whitelist of mutable RiskConfig fields with type/range validation.
 * `.strict()` rejects unknown keys so a request cannot inject arbitrary
 * columns (e.g. `id`) through Object.assign in RiskService.updateConfig.
 */
export const riskConfigUpdateSchema = z
  .object({
    simMaxOpenPositions: nonNegInt,
    realMaxOpenPositions: nonNegInt,
    maxExposureUsdc: nonNegNumber,
    maxDailyLossUsdc: nonNegNumber,
    maxPositionSizeUsdc: nonNegNumber,
    maxSlippagePercent: nonNegNumber,
    exitSlippageGuardPercent: nonNegNumber,
    preCloseSeconds: nonNegInt,
    killSwitchAction,
    realTradingEnabled: z.boolean(),
    simCopyTradingEnabled: z.boolean(),
    realCopyTradingEnabled: z.boolean(),
    simSizingMode: sizingMode,
    simCopyRatio: nonNegNumber,
    simEntryUsdcAmount: nonNegNumber,
    simEntryShareCount: entryShareCount,
    simKellyFraction: nonNegNumber,
    simRiskBudgetUsdc: nonNegNumber,
    simDefaultWinProbability: z.number().finite().min(0).max(1),
    simInitialCapitalCrypto: nonNegNumber,
    simInitialCapitalWeather: nonNegNumber,
    simInitialCapitalCopy: nonNegNumber,
    realSizingMode: sizingMode,
    realCopyRatio: nonNegNumber,
    realEntryUsdcAmount: nonNegNumber,
    realEntryShareCount: entryShareCount,
    realKellyFraction: nonNegNumber,
    realRiskBudgetUsdc: nonNegNumber,
    realDefaultWinProbability: z.number().finite().min(0).max(1),
    simSlCloseMaxRetries: nonNegInt,
    simTrailingEnabled: z.boolean(),
    simTrailingBidPoints: z.number().finite().min(0).max(1),
    simTrailingActivationBidPoints: z.number().finite().min(0).max(1),
    realSlCloseMaxRetries: nonNegInt,
    realTrailingEnabled: z.boolean(),
    realTrailingBidPoints: z.number().finite().min(0).max(1),
    realTrailingActivationBidPoints: z.number().finite().min(0).max(1),
    simSlEnabled: z.boolean(),
    simTpEnabled: z.boolean(),
    simSlBidPoints: z.number().finite().min(0).max(1),
    simTpBidPoints: z.number().finite().min(0).max(1),
    realSlBidPoints: z.number().finite().min(0).max(1),
    realTpBidPoints: z.number().finite().min(0).max(1),
    realSlEnabled: z.boolean(),
    realTpEnabled: z.boolean(),
    preCloseEnabled: z.boolean(),
    copyIncreaseEnabled: z.boolean(),
    copyDecreaseEnabled: z.boolean(),
    maxIncreasesPerPosition: nonNegInt,
    simMaxPositionSizeUsdc: nonNegNumber,
    realMaxPositionSizeUsdc: nonNegNumber,
    simMaxExposureUsdc: nonNegNumber,
    realMaxExposureUsdc: nonNegNumber,
    simMaxDailyLossUsdc: nonNegNumber,
    realMaxDailyLossUsdc: nonNegNumber,
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
    simMinBidToAskRatio: bidToAskRatio,
    simEntryDepthRetryMax: nonNegInt,
    simEntryDepthRetryDelayMs: nonNegInt,
    realMinBidToAskRatio: bidToAskRatio,
    realEntryDepthRetryMax: nonNegInt,
    realEntryDepthRetryDelayMs: nonNegInt,
    simMomentumFilterEnabled: z.boolean(),
    realMomentumFilterEnabled: z.boolean(),
    simPreCloseEnabled: z.boolean(),
    realPreCloseEnabled: z.boolean(),
    simPreCloseSeconds: nonNegInt,
    realPreCloseSeconds: nonNegInt,
    simPreCloseKeepEnabled: z.boolean(),
    simPreCloseKeepBidThreshold: z.number().finite().min(0).max(1),
    realPreCloseKeepEnabled: z.boolean(),
    realPreCloseKeepBidThreshold: z.number().finite().min(0).max(1),
    simMinTimeToClose: nonNegInt,
    realMinTimeToClose: nonNegInt,
    simAllowedMarketTags: z.array(z.string().min(1).max(100)).max(200),
    realAllowedMarketTags: z.array(z.string().min(1).max(100)).max(200),
    simSignalScoreSizingEnabled: z.boolean(),
    realSignalScoreSizingEnabled: z.boolean(),
    simAutoSnapshotEnabled: z.boolean(),
    simAutoSnapshotIntervalSeconds: nonNegInt,
    simAutoSnapshotEmptySession: z.boolean(),
    simSnapshotMaxCount: z.union([nonNegInt, z.null()]),
    simSnapshotRetentionDays: z.union([nonNegInt, z.null()]),
    simSnapshotDecisionWindowHours: z.number().int().min(1).max(168),
    moveDetectorIntervalMs: z
      .number()
      .int()
      .min(MIN_MOVE_DETECTOR_INTERVAL_MS)
      .max(MAX_MOVE_DETECTOR_INTERVAL_MS),
    cryptoAlgoEnabled: z.boolean(),
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
    cryptoAlgoPreCloseSeconds: z.union([nonNegInt, z.null()]),
    cryptoAlgoPreCloseKeepEnabled: z.boolean().nullable(),
    cryptoAlgoPreCloseKeepBidThreshold: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .nullable(),
    cryptoAlgoMinTimeToClose: z.union([nonNegInt, z.null()]),
    cryptoAlgoReentryWindowMs: z.number().int().min(1).max(86_400_000).nullable(),
    cryptoAlgoMaxEntriesPerWindow: z.number().int().min(1).max(20).nullable(),
    slConfirmationTicks: z.number().int().min(1).max(10),
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
    simExecLatencyMode: z.enum(['fixed', 'calibrated']).nullable(),
    simExecLatencyMs: z.union([nonNegInt, z.null()]),
    simSelfImpactEnabled: z.boolean().nullable(),
    simSelfImpactTtlSeconds: z.union([z.number().int().min(1).max(300), z.null()]),
    simWalletPreflightEnabled: z.boolean().nullable(),
    simShadowLoggingEnabled: z.boolean().nullable(),
    shadowSampleRetentionDays: z.union([z.number().int().min(1).max(365), z.null()]),
    weatherAlgoEnabled: z.boolean(),
    weatherAlgoMinEdge: z.number().finite().min(0.01).max(0.50),
    weatherAlgoMaxForecastStd: z.number().finite().min(0).max(20).nullable(),
    weatherAlgoSizingMode: z.enum(['fixed_usdc']),
    weatherAlgoEntryUsdc: z.number().finite().min(1).max(10000),
    weatherAlgoSelectionMode: z.enum(['single', 'multi']),
    weatherAlgoMaxSignalsPerEvent: z.number().int().min(1).max(20),
    weatherAlgoForecastChangeThreshold: z.number().finite().min(0.5).max(20),
    weatherAlgoCloseBeforeResolutionHours: z.number().finite().min(0.5).max(168),
    weatherAlgoPollMs: z.number().int().min(60_000).max(86_400_000),
    weatherAlgoCityFollowSwitchMode: z.enum(['close_and_reenter', 'hold']),
    weatherAlgoBucketHysteresisPolls: z.number().int().min(1).max(10),
    weatherAlgoReentryThrottleMs: z.number().int().min(0).max(86_400_000),
  })
  .partial()
  .strict();

export function createConfigRouter(ds: DataSource): Router {
  const router = Router();
  const riskService = new RiskService(ds);
  const cryptoConfigService = new CryptoConfigService(ds);
  const revisionService = new RiskConfigRevisionService(ds);
  const rotationService = new SessionRotationService(ds);

  // TODO: remove after all callers migrate to /api/config/*
  // Legacy alias — kept for backward compat during migration.
  router.get('/risk-config', requireJwt, async (_req, res) => {
    const config = await riskService.getConfig();
    const cryptoCfg = await cryptoConfigService.getConfig();
    res.json({
      ...presentRiskConfigForApi(config),
      cryptoAlgoConfigFingerprint: computeCryptoAlgoConfigFingerprint(cryptoCfg),
    });
  });

  router.get('/sim-execution-stats', requireJwt, async (_req, res) => {
    res.json(await fetchSimExecutionStats(ds));
  });

  // TODO: remove after all callers migrate to /api/config/*
  router.put('/risk-config', requireJwt, async (req, res) => {
    const raw = req.body as Record<string, unknown>;
    const expectedFingerprint =
      typeof raw.expectedCryptoAlgoConfigFingerprint === 'string'
        ? raw.expectedCryptoAlgoConfigFingerprint
        : undefined;
    const {
      expectedCryptoAlgoConfigFingerprint: _ignoredFp,
      revisionSource: _ignoredRs,
      ...configBody
    } = raw;
    const parsed = riskConfigUpdateSchema.safeParse(configBody);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const tunableErrors = validateCryptoAlgoTunablesUpdate(parsed.data);
    if (tunableErrors.length > 0) {
      res.status(400).json({
        error: 'invalid_body',
        message: tunableErrors
          .map((e) => `${e.field}: ${e.message}`)
          .join('; '),
      });
      return;
    }
    try {
      if (expectedFingerprint) {
        const current = await cryptoConfigService.getConfig();
        const currentFingerprint = computeCryptoAlgoConfigFingerprint(current);
        if (currentFingerprint !== expectedFingerprint) {
          res.status(409).json({
            error: 'config_fingerprint_mismatch',
            message:
              'La config live a changé depuis la génération du rapport. Régénérez le rapport avant d’appliquer.',
            currentFingerprint,
          });
          return;
        }
      }
      const revisionSource =
        typeof raw.revisionSource === 'string' &&
        (raw.revisionSource === 'api' ||
          raw.revisionSource === 'report_apply' ||
          raw.revisionSource === 'system')
          ? raw.revisionSource
          : 'api';
      const before = await riskService.getConfig();
      const updated = await riskService.updateConfig(
        toRiskConfigEntityUpdate(parsed.data),
      );
      await revisionService.recordRevision(updated, {
        source: revisionSource,
        patch: parsed.data,
      });

      // Re-stamp meta keys in-place on active sessions (no rotation)
      // Then check if rotation keys changed
      const rotation = await rotationService.rotateOnConfigChange(before, updated);

      await publishConfigChanged();
      const updatedCryptoCfg = await cryptoConfigService.getConfig();
      res.json({
        ...presentRiskConfigForApi(updated),
        cryptoAlgoConfigFingerprint: computeCryptoAlgoConfigFingerprint(updatedCryptoCfg),
        sessionRotation: rotation.sim || rotation.real ? {
          sim: rotation.sim ?? null,
          real: rotation.real ?? null,
        } : undefined,
      });
    } catch (e) {
      if ((e as Error).message === 'insecure_secrets_real_trading_blocked') {
        res.status(403).json({
          error: 'insecure_secrets_real_trading_blocked',
          message:
            'Generate unique JWT_SECRET, SERVICE_TOKEN and MASTER_ENCRYPTION_KEY before enabling real trading (npm run generate-secrets).',
        });
        return;
      }
      throw e;
    }
  });

  const credsSchema = z.object({
    walletAddress: ethAddressSchema,
    apiKey: z.string().optional(),
    secret: z.string().optional(),
    passphrase: z.string().optional(),
    signerPrivateKey: z.string().optional(),
    signatureType: z.number().int().min(0).max(3).optional(),
    funderAddress: emptyableEthAddressSchema.optional(),
    builderApiKey: z.string().optional(),
    builderSecret: z.string().optional(),
    builderPassphrase: z.string().optional(),
    relayerUrl: z.string().optional(),
  });

  router.get('/clob-credentials/status', requireJwt, async (_req, res) => {
    const repo = ds.getRepository(ClobCredentials);
    const creds = await repo.findOne({ where: {} });
    const readiness = await evaluateStoredClobReadiness(ds);
    res.json({
      configured: readiness.configured,
      liveReady: readiness.liveReady,
      blockReason: readiness.blockReason,
      depositWalletSignatureType: readiness.depositWalletSignatureType,
      walletAddress: creds?.walletAddress ?? null,
      funderAddress: creds?.funderAddress ?? null,
      signatureType: readiness.signatureType,
      relayerUrl: creds?.relayerUrl ?? null,
      hasApiKey: !!creds?.apiKeyEnc,
      hasSecret: !!creds?.secretEnc,
      hasPassphrase: !!creds?.passphraseEnc,
      hasSignerPk: !!creds?.signerPkEnc,
      hasBuilderApiKey: !!creds?.builderApiKeyEnc,
      hasBuilderSecret: !!creds?.builderSecretEnc,
      hasBuilderPassphrase: !!creds?.builderPassphraseEnc,
    });
  });

  router.post('/clob-credentials', requireJwt, async (req, res) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const data = parsed.data;
    const repo = ds.getRepository(ClobCredentials);
    let creds = await repo.findOne({ where: {} });
    if (!creds) creds = repo.create({ walletAddress: data.walletAddress });

    creds.walletAddress = data.walletAddress;
    if (data.apiKey) creds.apiKeyEnc = encrypt(data.apiKey);
    if (data.secret) creds.secretEnc = encrypt(data.secret);
    if (data.passphrase) creds.passphraseEnc = encrypt(data.passphrase);
    if (data.signerPrivateKey) creds.signerPkEnc = encrypt(data.signerPrivateKey);
    if (data.signatureType !== undefined) creds.signatureType = data.signatureType;
    if (data.funderAddress) creds.funderAddress = data.funderAddress;
    if (data.builderApiKey) creds.builderApiKeyEnc = encrypt(data.builderApiKey);
    if (data.builderSecret) creds.builderSecretEnc = encrypt(data.builderSecret);
    if (data.builderPassphrase) creds.builderPassphraseEnc = encrypt(data.builderPassphrase);
    if (data.relayerUrl !== undefined) {
      creds.relayerUrl = data.relayerUrl.trim() || null;
    }

    await repo.save(creds);
    await publishConfigChanged();
    res.json({ ok: true, walletAddress: creds.walletAddress });
  });

  router.delete('/clob-credentials', requireJwt, async (_req, res) => {
    await ds.getRepository(ClobCredentials).delete({});
    await new GlobalConfigService(ds).updateConfig({ realTradingEnabled: false });
    RiskService.invalidateConfigCache();
    await publishConfigChanged();
    res.status(204).end();
  });

  router.get('/integration-settings/polygonscan/status', requireJwt, async (_req, res) => {
    res.json(await getPolygonscanSettingsStatus(ds));
  });

  const polygonscanKeySchema = z.object({
    apiKey: z.string().min(1).max(256),
  });

  router.put('/integration-settings/polygonscan', requireJwt, async (req, res) => {
    const parsed = polygonscanKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    try {
      await savePolygonscanApiKey(ds, parsed.data.apiKey);
      clearTraderFundingCache();
      res.json(await getPolygonscanSettingsStatus(ds));
    } catch (e) {
      const message = (e as Error).message;
      if (message === 'polygonscan_api_key_env_locked') {
        res.status(409).json({
          error: 'polygonscan_api_key_env_locked',
          message:
            'La clé est déjà définie via POLYGONSCAN_API_KEY dans l’environnement serveur.',
        });
        return;
      }
      if (message === 'polygonscan_api_key_required') {
        res.status(400).json({ error: 'polygonscan_api_key_required' });
        return;
      }
      throw e;
    }
  });

  router.delete('/integration-settings/polygonscan', requireJwt, async (_req, res) => {
    try {
      await clearStoredPolygonscanApiKey(ds);
      clearTraderFundingCache();
      res.status(204).end();
    } catch (e) {
      if ((e as Error).message === 'polygonscan_api_key_env_locked') {
        res.status(409).json({
          error: 'polygonscan_api_key_env_locked',
          message:
            'Impossible de supprimer une clé gérée par POLYGONSCAN_API_KEY côté serveur.',
        });
        return;
      }
      throw e;
    }
  });

  return router;
}
