import { DataSource, Repository } from 'typeorm';
import { MarketSyncConfig } from '../entities/MarketSyncConfig.js';

export class MarketSyncConfigService {
  private repo: Repository<MarketSyncConfig>;

  constructor(private readonly ds: DataSource) {
    this.repo = ds.getRepository(MarketSyncConfig);
  }

  async getConfig(): Promise<MarketSyncConfig> {
    let config = await this.repo.findOne({ where: {} });
    if (!config) {
      config = this.repo.create();
      config = await this.repo.save(config);
    }
    return config;
  }

  async updateConfig(patch: Partial<MarketSyncConfig>): Promise<MarketSyncConfig> {
    const config = await this.getConfig();
    Object.assign(config, patch);
    return this.repo.save(config);
  }
}
