import type { DataSource, EntityManager } from 'typeorm';
import { canEnableRealTrading } from '../config/secrets.js';
import { Execution } from '../entities/Execution.js';
import { RiskConfig } from '../entities/RiskConfig.js';
import { getModeKillSwitchAction, getModeMaxDailyLossUsdc } from '../risk/policy.js';
import type { KillSwitchAction, TradingMode } from '../types/index.js';

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

  async getConfig(options?: GetRiskConfigOptions): Promise<RiskConfig> {
    const bypassCache = options?.bypassCache === true || options?.manager != null;
    if (!bypassCache) {
      const cached = RiskService.configCache;
      if (cached && Date.now() < cached.expiresAt) {
        return cached.config;
      }
    }

    const repo = (options?.manager ?? this.ds.manager).getRepository(RiskConfig);
    const config = await repo.findOne({ where: {} });
    if (!config) throw new Error('Risk config not found');
    if (!bypassCache) {
      RiskService.configCache = {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      };
    }
    return config;
  }

  /**
   * Live check of whether real trading is currently enabled. Call sites should
   * prefer this over cached config values when guarding execution of real BUY
   * signals, because the flag can be toggled while signals are in flight.
   */
  async isRealTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isRealTradingEnabledForConfig(config);
  }

  /**
   * Pure helper shared by all real-mode guards so the rule "real trading must be
   * enabled" is expressed in exactly one place.
   */
  static isRealTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.realTradingEnabled;
  }

  /**
   * Live check of whether sim copy trading entries are enabled. Prefer over
   * cached config when guarding in-flight sim COPY BUY signals.
   */
  async isSimCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isSimCopyTradingEnabledForConfig(config);
  }

  /** Pure helper for sim copy entry guards (COPY_OPEN / COPY_INCREASE only). */
  static isSimCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.simCopyTradingEnabled;
  }

  /**
   * Live check of whether real copy trading entries are enabled. Prefer over
   * cached config when guarding in-flight real COPY BUY signals.
   */
  async isRealCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isRealCopyTradingEnabledForConfig(config);
  }

  /** Pure helper for real copy entry guards (COPY_OPEN / COPY_INCREASE only). */
  static isRealCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.realCopyTradingEnabled;
  }

  /**
   * Live check of whether any copy-trading mode (sim or real) is enabled.
   * Used by the move detector to decide whether to poll watched addresses.
   */
  async isAnyCopyTradingEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return RiskService.isAnyCopyTradingEnabledForConfig(config);
  }

  /** Pure helper — true if sim OR real copy trading entries are enabled. */
  static isAnyCopyTradingEnabledForConfig(risk: RiskConfig): boolean {
    return risk.simCopyTradingEnabled || risk.realCopyTradingEnabled;
  }

  async updateConfig(partial: Partial<RiskConfig>): Promise<RiskConfig> {
    if (partial.realTradingEnabled === true) {
      const allowed = canEnableRealTrading({
        masterEncryptionKey: process.env.MASTER_ENCRYPTION_KEY ?? '',
        serviceToken: process.env.SERVICE_TOKEN ?? '',
      });
      if (!allowed) {
        throw new Error('insecure_secrets_real_trading_blocked');
      }
    }
    const repo = this.ds.getRepository(RiskConfig);
    const config = await this.getUncachedConfig();
    Object.assign(config, partial);
    RiskService.invalidateConfigCache();
    return repo.save(config);
  }

  private async getUncachedConfig(): Promise<RiskConfig> {
    const config = await this.ds.getRepository(RiskConfig).findOne({
      where: {},
    });
    if (!config) throw new Error('Risk config not found');
    return config;
  }

  async checkKillSwitch(mode: TradingMode): Promise<RiskCheckResult> {
    const config = await this.getConfig();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const result = await this.ds
      .getRepository(Execution)
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.realized_pnl), 0)', 'total')
      .where('e.mode = :mode', { mode })
      .andWhere('e.executed_at >= :start', { start: startOfDay })
      .getRawOne<{ total: number }>();

    const dailyNet = result?.total ?? 0;
    const triggered = dailyNet < 0 && Math.abs(dailyNet) >= getModeMaxDailyLossUsdc(config, mode);
    const action = getModeKillSwitchAction(config, mode) as KillSwitchAction;

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
