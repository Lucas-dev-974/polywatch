import type { DataSource, EntityManager } from 'typeorm';
import { canEnableRealTrading } from '../config/secrets.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { RiskConfig } from '../entities/RiskConfig.js';
import { GlobalConfig } from '../entities/GlobalConfig.js';
import { CopyConfig } from '../entities/CopyConfig.js';
import { CryptoConfig } from '../entities/CryptoConfig.js';
import { WeatherConfig } from '../entities/WeatherConfig.js';
import { GlobalConfigService } from './global-config.service.js';
import { CopyConfigService } from './copy-config.service.js';
import { CryptoConfigService } from './crypto-config.service.js';
import { WeatherConfigService } from './weather-config.service.js';
import {
  getCopyMaxDailyLossUsdc,
  getCopyKillSwitchAction,
  getCryptoMaxDailyLossUsdc,
  getCryptoKillSwitchAction,
  getWeatherMaxDailyLossUsdc,
  getWeatherKillSwitchAction,
} from '../risk/policy.js';
import { toWeatherConfigEntityUpdate } from '../risk/weather-config-api.js';
import {
  detectRiskConfigDivergences,
  handleRiskConfigDivergence,
  RiskConfigLegacyFacadeDisabledError,
} from '../risk/risk-config-divergence.js';
import { SystemConfigService } from './system-config.service.js';
import type { KillSwitchAction, TradingMode } from '../types/index.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';
import pino from 'pino';

const log = pino({ name: 'risk-service' });

/** Fail-open: if system_config is unreachable, use the provided fallback (never block trading). */
async function readFeatureFlagSafe(
  ds: DataSource,
  shortKey: string,
  fallback: boolean,
): Promise<boolean> {
  try {
    return await new SystemConfigService(ds).getFeatureFlag(shortKey, fallback);
  } catch (err) {
    log.warn(
      { err, key: shortKey, fallback },
      'feature flag read failed — using fallback (fail-open)',
    );
    return fallback;
  }
}

export interface RiskCheckResult {
  killSwitchTriggered: boolean;
  blockEntries: boolean;
  action: KillSwitchAction;
}

export interface GetRiskConfigOptions {
  manager?: EntityManager;
  /** When true, skip the in-memory TTL cache (use inside snapshot transactions). */
  bypassCache?: boolean;
}

const CONFIG_CACHE_TTL_MS = 5_000;

type ConfigCache = {
  config: RiskConfig;
  expiresAt: number;
};

export class RiskService {
  private static configCache: ConfigCache | null = null;

  constructor(private readonly ds: DataSource) {}

  static invalidateConfigCache(): void {
    RiskService.configCache = null;
  }

  // ─── Legacy merged config (rétro-compat facade over isolated tables) ─

  async getConfig(options?: GetRiskConfigOptions): Promise<RiskConfig> {
    const legacyFacadeEnabled = await readFeatureFlagSafe(
      this.ds,
      'risk_config_legacy_facade',
      true,
    );
    if (!legacyFacadeEnabled) {
      throw new RiskConfigLegacyFacadeDisabledError();
    }

    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = RiskService.configCache;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const [global, copy, crypto, weather] = await Promise.all([
      this.getGlobalConfig(options),
      this.getCopyConfig(options),
      this.getCryptoConfig(options),
      this.getWeatherConfig(options),
    ]);

    // Compose a RiskConfig-shaped object from the four isolated tables so that
    // legacy callers (and the few remaining legacy getters) keep working.
    const composed = this.composeRiskConfig(global, copy, crypto, weather);
    await this.assertNoDivergence(composed, global, copy, crypto, weather);

    if (!bypassCache) {
      RiskService.configCache = {
        config: composed,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      };
    }
    return composed;
  }

  async updateConfig(partial: Partial<RiskConfig>): Promise<RiskConfig> {
    const legacyFacadeEnabled = await readFeatureFlagSafe(
      this.ds,
      'risk_config_legacy_facade',
      true,
    );
    if (!legacyFacadeEnabled) {
      throw new RiskConfigLegacyFacadeDisabledError();
    }

    if (partial.realTradingEnabled === true) {
      const allowed = canEnableRealTrading({
        masterEncryptionKey: process.env.MASTER_ENCRYPTION_KEY ?? '',
        serviceToken: process.env.SERVICE_TOKEN ?? '',
      });
      if (!allowed) {
        throw new Error('insecure_secrets_real_trading_blocked');
      }
    }

    // Dual-write: dispatch to the 4 new tables
    await this.dualWriteConfig(partial);

    // Invalidate every isolated config cache so consumers pick up the change.
    RiskService.invalidateConfigCache();
    GlobalConfigService.invalidateConfigCache();
    CopyConfigService.invalidateConfigCache();
    CryptoConfigService.invalidateConfigCache();
    WeatherConfigService.invalidateConfigCache();

    return this.getConfig({ bypassCache: true });
  }

  /**
   * Dual-write the partial update to the new isolated tables.
   * Each field is mapped to its target table.
   */
  private async dualWriteConfig(partial: Partial<RiskConfig>): Promise<void> {
    const globalRepo = this.ds.getRepository(GlobalConfig);
    const copyRepo = this.ds.getRepository(CopyConfig);
    const cryptoRepo = this.ds.getRepository(CryptoConfig);
    const weatherRepo = this.ds.getRepository(WeatherConfig);

    // Global fields
    const globalFields: (keyof GlobalConfig)[] = [
      'maxSlippagePercent', 'exitSlippageGuardPercent', 'realTradingEnabled', 'realCashOverride',
      'simExecLatencyMode', 'simExecLatencyMs', 'simSelfImpactEnabled', 'simSelfImpactTtlSeconds',
      'simWalletPreflightEnabled', 'simShadowLoggingEnabled', 'shadowSampleRetentionDays',
      'simAutoSnapshotEnabled', 'simAutoSnapshotIntervalSeconds', 'simSnapshotMaxCount',
      'simSnapshotRetentionDays', 'simAutoSnapshotEmptySession', 'simSnapshotDecisionWindowHours',
      'realAutoSnapshotEnabled', 'realAutoSnapshotIntervalSeconds', 'realSnapshotMaxCount',
      'realSnapshotRetentionDays', 'realSnapshotDecisionWindowHours',
    ];
    const globalPatch: Partial<GlobalConfig> = {};
    for (const key of globalFields) {
      if (key in partial) {
        (globalPatch as Record<string, unknown>)[key] = (partial as Record<string, unknown>)[key];
      }
    }
    if (Object.keys(globalPatch).length > 0) {
      const globalConfig = await globalRepo.findOne({ where: {} });
      if (globalConfig) {
        Object.assign(globalConfig, globalPatch);
        await globalRepo.save(globalConfig);
      }
    }

    // Copy fields
    const copyFields: (keyof CopyConfig)[] = [
      'simCopyTradingEnabled', 'realCopyTradingEnabled', 'simCopyRatio', 'simEntryUsdcAmount',
      'simEntryShareCount', 'simKellyFraction', 'simRiskBudgetUsdc', 'simDefaultWinProbability',
      'simSizingMode', 'realSizingMode', 'simMaxOpenPositions', 'realMaxOpenPositions',
      'simMaxPositionSizeUsdc', 'realMaxPositionSizeUsdc', 'simMaxExposureUsdc', 'realMaxExposureUsdc',
      'simMaxDailyLossUsdc', 'realMaxDailyLossUsdc', 'simSlBidPoints', 'realSlBidPoints',
      'simTpBidPoints', 'realTpBidPoints', 'simTrailingBidPoints', 'realTrailingBidPoints',
      'simTrailingActivationBidPoints', 'realTrailingActivationBidPoints',
      'simSlEnabled', 'simTpEnabled', 'simTrailingEnabled', 'realSlEnabled', 'realTpEnabled', 'realTrailingEnabled',
      'simKillSwitchAction', 'realKillSwitchAction', 'simMinBidToAskRatio', 'realMinBidToAskRatio',
      'simEntryDepthRetryMax', 'realEntryDepthRetryMax', 'simEntryDepthRetryDelayMs', 'realEntryDepthRetryDelayMs',
      'simSlCloseMaxRetries', 'realSlCloseMaxRetries',
      'preCloseEnabled', 'preCloseSeconds', 'simPreCloseEnabled', 'realPreCloseEnabled',
      'simPreCloseSeconds', 'realPreCloseSeconds', 'simMinTimeToClose', 'realMinTimeToClose',
      'simPreCloseKeepEnabled', 'realPreCloseKeepEnabled', 'simPreCloseKeepBidThreshold', 'realPreCloseKeepBidThreshold',
      'simAllowedMarketTags', 'realAllowedMarketTags', 'simSignalScoreSizingEnabled', 'realSignalScoreSizingEnabled',
      'copyIncreaseEnabled', 'copyDecreaseEnabled', 'maxIncreasesPerPosition',
      'simCopyIncreaseEnabled', 'realCopyIncreaseEnabled', 'simCopyDecreaseEnabled', 'realCopyDecreaseEnabled',
      'simMaxIncreasesPerPosition', 'realMaxIncreasesPerPosition',
      'simCopyIncreaseSlProximityEnabled', 'realCopyIncreaseSlProximityEnabled',
      'simCopyIncreaseSlProximityPercent', 'realCopyIncreaseSlProximityPercent',
      'moveDetectorIntervalMs', 'simInitialCapitalCopy', 'slConfirmationTicks',
      'simMomentumFilterEnabled', 'realMomentumFilterEnabled',
    ];
    const copyPatch: Partial<CopyConfig> = {};
    for (const key of copyFields) {
      if (key in partial) {
        (copyPatch as Record<string, unknown>)[key] = (partial as Record<string, unknown>)[key];
      }
    }
    if (Object.keys(copyPatch).length > 0) {
      const copyConfig = await copyRepo.findOne({ where: {} });
      if (copyConfig) {
        Object.assign(copyConfig, copyPatch);
        await copyRepo.save(copyConfig);
      }
    }

    // Crypto fields
    const cryptoFields: (keyof CryptoConfig)[] = [
      'cryptoAlgoEnabled', 'cryptoAlgoStrategies', 'cryptoAlgoStrategyParams',
      'cryptoAlgoSlEnabled', 'cryptoAlgoTpEnabled',
      'cryptoAlgoTrailingEnabled', 'cryptoAlgoSlBidPoints', 'cryptoAlgoTpBidPoints',
      'cryptoAlgoTrailingBidPoints', 'cryptoAlgoTrailingActivationBidPoints',
      'cryptoAlgoPreCloseEnabled', 'cryptoAlgoPreCloseSeconds', 'cryptoAlgoPreCloseKeepEnabled',
      'cryptoAlgoPreCloseKeepBidThreshold', 'cryptoAlgoMinTimeToClose',
      'cryptoAlgoReentryWindowMs', 'cryptoAlgoMaxEntriesPerWindow',
      'cryptoAlgoBaseThreshold', 'cryptoAlgoSpreadAdjustmentFactor',
      'cryptoAlgoMinSpreadAbsForAdjustment', 'cryptoAlgoMaxSpreadAbs',
      'cryptoAlgoPriceSumTolerance', 'cryptoAlgoWarnPriceDeviation',
      'cryptoAlgoMaxBookAgeMs', 'cryptoAlgoGammaCacheTtlShortMs', 'cryptoAlgoGammaCacheTtlDefaultMs',
      'cryptoAlgoGammaStaleOnErrorFactor', 'cryptoAlgoWsDebounceMs', 'cryptoAlgoPollMs',
      'cryptoAlgoTickIntervalMs', 'cryptoAlgoTickRetentionHours', 'cryptoAlgoPriceTickRefQty',
      'cryptoAlgoPriceTickCleanupEnabled', 'cryptoAlgoPriceTickCleanupIntervalMinutes',
      'cryptoAlgoMinTimeToCloseBufferSeconds', 'cryptoAlgoLastCloseableBidMaxAgeMs',
      'cryptoAlgoSpreadAbsByInterval', 'cryptoAlgoExitDefaultsByInterval', 'cryptoAlgoPreCloseSecondsByInterval',
      'cryptoAlgoSlQuotaEnabled', 'cryptoAlgoSlQuotaPerMarket', 'cryptoAlgoSlQuotaCacheTtlSeconds',
      'cryptoAlgoEntryPriceMin', 'cryptoAlgoEntryPriceMax', 'cryptoAlgoEntryPriceBandEnabled',
      'cryptoAlgoCurveFilterEnabled', 'cryptoAlgoCurveLookbackMs', 'cryptoAlgoCurveMinDelta',
      'cryptoAlgoSizingMode', 'cryptoAlgoEntryUsdcAmount', 'cryptoAlgoEntryShareCount',
      'cryptoAlgoMaxOpenPositions', 'cryptoAlgoMaxExposureUsdc', 'cryptoAlgoMaxDailyLossUsdc',
      'cryptoAlgoMaxPositionSizeUsdc', 'cryptoAlgoKillSwitchAction', 'cryptoAlgoMinBidToAskRatio',
      'cryptoAlgoEntryDepthRetryMax', 'cryptoAlgoEntryDepthRetryDelayMs', 'cryptoAlgoSlCloseMaxRetries',
      'cryptoAlgoAllowedMarketTags', 'cryptoAlgoSignalScoreSizingEnabled', 'cryptoAlgoSlConfirmationTicks',
      'simInitialCapitalCrypto',
    ];
    const cryptoPatch: Partial<CryptoConfig> = {};
    for (const key of cryptoFields) {
      if (key in partial) {
        (cryptoPatch as Record<string, unknown>)[key] = (partial as Record<string, unknown>)[key];
      }
    }
    if (Object.keys(cryptoPatch).length > 0) {
      const cryptoConfig = await cryptoRepo.findOne({ where: {} });
      if (cryptoConfig) {
        Object.assign(cryptoConfig, cryptoPatch);
        await cryptoRepo.save(cryptoConfig);
      }
    }

    // Weather fields
    const weatherFields: (keyof WeatherConfig)[] = [
      'weatherAlgoEnabled', 'weatherAlgoSimEnabled', 'weatherAlgoRealEnabled',
      'weatherAlgoMinEdge', 'weatherAlgoMaxForecastStd', 'weatherAlgoSizingMode',
      'weatherAlgoEntryUsdc', 'weatherAlgoSelectionMode', 'weatherAlgoMaxSignalsPerEvent',
      'weatherAlgoForecastChangeThreshold', 'weatherAlgoCloseBeforeResolutionHours',
      'weatherAlgoPollMs', 'weatherAlgoCityFollowSwitchMode',
      'weatherAlgoBucketHysteresisPolls', 'weatherAlgoReentryThrottleMs',
      'weatherAlgoMaxOpenPositions', 'weatherAlgoMaxExposureUsdc', 'weatherAlgoMaxDailyLossUsdc',
      'weatherAlgoMaxPositionSizeUsdc', 'weatherAlgoSlBidPoints', 'weatherAlgoTpBidPoints',
      'weatherAlgoTrailingBidPoints', 'weatherAlgoTrailingActivationBidPoints',
      'weatherAlgoPreCloseSeconds', 'weatherAlgoPreCloseEnabled', 'weatherAlgoSlEnabled',
      'weatherAlgoTpEnabled', 'weatherAlgoTrailingEnabled',
      'weatherAlgoKillSwitchAction', 'weatherAlgoMinBidToAskRatio',
      'weatherAlgoEntryDepthRetryMax', 'weatherAlgoEntryDepthRetryDelayMs', 'weatherAlgoSlCloseMaxRetries',
      'weatherAlgoMinTimeToClose', 'weatherAlgoAllowedMarketTags', 'weatherAlgoSignalScoreSizingEnabled',
      'weatherAlgoSlConfirmationTicks',
      'simInitialCapitalWeather',
    ];
    const weatherPatch: Partial<WeatherConfig> = {};
    for (const key of weatherFields) {
      if (key in partial) {
        (weatherPatch as Record<string, unknown>)[key] = (partial as Record<string, unknown>)[key];
      }
    }
    if (Object.keys(weatherPatch).length > 0) {
      const weatherConfig = await weatherRepo.findOne({ where: {} });
      if (weatherConfig) {
        Object.assign(weatherConfig, toWeatherConfigEntityUpdate(weatherPatch));
        await weatherRepo.save(weatherConfig);
      }
    }
  }

  private composeRiskConfig(
    global: GlobalConfig,
    copy: CopyConfig,
    crypto: CryptoConfig,
    weather: WeatherConfig,
  ): RiskConfig {
    return {
      ...global,
      ...copy,
      ...crypto,
      ...weather,
      id: 0,
    } as unknown as RiskConfig;
  }

  private async assertNoDivergence(
    composed: RiskConfig,
    global: GlobalConfig,
    copy: CopyConfig,
    crypto: CryptoConfig,
    weather: WeatherConfig,
  ): Promise<void> {
    const divergences = detectRiskConfigDivergences(composed, global, copy, crypto, weather);
    // Fail-open: if the flag cannot be read, stay in log-only mode (strict=false).
    const strict = await readFeatureFlagSafe(this.ds, 'risk_config_strict', false);
    handleRiskConfigDivergence(divergences, strict, log);
  }

  // ─── New per-algo getters ─────────────────────────────────────────────

  async getGlobalConfig(options?: GetRiskConfigOptions): Promise<GlobalConfig> {
    const repo = (options?.manager ?? this.ds.manager).getRepository(GlobalConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Global config not found');
    return config;
  }

  async getCopyConfig(options?: GetRiskConfigOptions): Promise<CopyConfig> {
    const repo = (options?.manager ?? this.ds.manager).getRepository(CopyConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Copy config not found');
    return config;
  }

  async getCryptoConfig(options?: GetRiskConfigOptions): Promise<CryptoConfig> {
    const repo = (options?.manager ?? this.ds.manager).getRepository(CryptoConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Crypto config not found');
    return config;
  }

  async getWeatherConfig(options?: GetRiskConfigOptions): Promise<WeatherConfig> {
    const repo = (options?.manager ?? this.ds.manager).getRepository(WeatherConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Weather config not found');
    return config;
  }

  /**
   * Load the algo-specific config for a given algoKind.
   * Used by the worker to load the right config for close signals.
   */
  async getConfigForAlgo(algoKind: SimAlgoKind): Promise<CopyConfig | CryptoConfig | WeatherConfig> {
    switch (algoKind) {
      case 'copy':
        return this.getCopyConfig();
      case 'crypto':
        return this.getCryptoConfig();
      case 'weather':
        return this.getWeatherConfig();
      default:
        throw new Error(`Unsupported algoKind: ${algoKind}`);
    }
  }

  // ─── Legacy guards (rétro-compat, now compose from isolated tables) ──

  async isRealTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isRealTradingEnabledForConfig(config);
  }

  static isRealTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.realTradingEnabled;
  }

  async isSimCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isSimCopyTradingEnabledForConfig(config);
  }

  static isSimCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.simCopyTradingEnabled;
  }

  async isRealCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isRealCopyTradingEnabledForConfig(config);
  }

  static isRealCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.realCopyTradingEnabled;
  }

  async isAnyCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isAnyCopyTradingEnabledForConfig(config);
  }

  static isAnyCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.simCopyTradingEnabled || risk.realCopyTradingEnabled;
  }

  // ─── New per-algo real trading guards ────────────────────────────────

  async isRealCryptoTradingEnabled(): Promise<boolean> {
    const [global, crypto] = await Promise.all([
      this.getGlobalConfig(),
      this.getCryptoConfig(),
    ]);
    return global.realTradingEnabled && crypto.cryptoAlgoEnabled;
  }

  async isRealWeatherTradingEnabled(): Promise<boolean> {
    const [global, weather] = await Promise.all([
      this.getGlobalConfig(),
      this.getWeatherConfig(),
    ]);
    return global.realTradingEnabled && weather.weatherAlgoRealEnabled;
  }

  // ─── Kill switch ────────────────────────────────────────────────────

  async checkKillSwitch(algoKind: SimAlgoKind, mode: TradingMode): Promise<RiskCheckResult> {
    const config = await this.getConfigForAlgo(algoKind);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Sum realized PnL only for executions whose opening position belongs to
    // the requested algoKind. Exit reasons (SL/TP/TRAILING) are shared across
    // algos, so we scope via the parent CopiedPosition.reason.
    const result = await this.ds
      .getRepository(Execution)
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.realized_pnl), 0)', 'total')
      .innerJoin(CopiedPosition, 'p', 'p.id = e.copied_position_id')
      .where('e.mode = :mode', { mode })
      .andWhere('e.executed_at >= :start', { start: startOfDay })
      .andWhere('p.reason IN (:...reasons)', { reasons: openingReasonsForAlgoKind(algoKind) })
      .getRawOne<{ total: number }>();

    const dailyNet = result?.total ?? 0;

    let triggered: boolean;
    let action: KillSwitchAction;
    if (algoKind === 'copy') {
      triggered = dailyNet < 0 && Math.abs(dailyNet) >= getCopyMaxDailyLossUsdc(config as CopyConfig, mode);
      action = getCopyKillSwitchAction(config as CopyConfig, mode) as KillSwitchAction;
    } else if (algoKind === 'crypto') {
      triggered = dailyNet < 0 && Math.abs(dailyNet) >= getCryptoMaxDailyLossUsdc(config as CryptoConfig, mode);
      action = getCryptoKillSwitchAction(config as CryptoConfig, mode) as KillSwitchAction;
    } else {
      triggered = dailyNet < 0 && Math.abs(dailyNet) >= getWeatherMaxDailyLossUsdc(config as WeatherConfig, mode);
      action = getWeatherKillSwitchAction(config as WeatherConfig, mode) as KillSwitchAction;
    }

    return {
      killSwitchTriggered: triggered,
      blockEntries:
        triggered &&
        (action === 'block_entries' || action === 'block_and_notify'),
      action: triggered ? action : 'block_entries',
    };
  }

  shouldBlockEntry(killSwitch: RiskCheckResult): boolean {
    return killSwitch.blockEntries;
  }

  shouldForceCloseAll(killSwitch: RiskCheckResult): boolean {
    return killSwitch.killSwitchTriggered && killSwitch.action === 'force_close_all';
  }

  shouldBlockAndNotify(killSwitch: RiskCheckResult): boolean {
    return killSwitch.killSwitchTriggered && killSwitch.action === 'block_and_notify';
  }

  private async getUncachedConfig(): Promise<RiskConfig> {
    return this.getConfig({ bypassCache: true });
  }
}

function openingReasonsForAlgoKind(algoKind: SimAlgoKind): string[] {
  switch (algoKind) {
    case 'copy':
      return ['COPY_OPEN', 'COPY_INCREASE'];
    case 'crypto':
      return ['ALGO_OPEN', 'ALGO_INCREASE'];
    case 'weather':
      return ['WEATHER_OPEN', 'WEATHER_FORECAST_CHANGE'];
  }
}
