import type { DataSource, EntityManager } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
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
import type { KillSwitchAction, TradingMode } from '../types/index.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';

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

export class RiskService {
  constructor(private readonly ds: DataSource) {}

  static invalidateConfigCache(): void {
    GlobalConfigService.invalidateConfigCache();
    CopyConfigService.invalidateConfigCache();
    CryptoConfigService.invalidateConfigCache();
    WeatherConfigService.invalidateConfigCache();
  }

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
  async getConfigForAlgo(
    algoKind: SimAlgoKind,
    options?: GetRiskConfigOptions,
  ): Promise<CopyConfig | CryptoConfig | WeatherConfig> {
    switch (algoKind) {
      case 'copy':
        return this.getCopyConfig(options);
      case 'crypto':
        return this.getCryptoConfig(options);
      case 'weather':
        return this.getWeatherConfig(options);
      default:
        throw new Error(`Unsupported algoKind: ${algoKind}`);
    }
  }

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

  async checkKillSwitch(algoKind: SimAlgoKind, mode: TradingMode): Promise<RiskCheckResult> {
    const config = await this.getConfigForAlgo(algoKind);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

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
