import type { DataSource, EntityManager } from 'typeorm';
import { AnalysisReport } from '../entities/AnalysisReport.js';
import type { RiskConfig } from '../entities/RiskConfig.js';
import {
  RiskConfigRevision,
  type RiskConfigRevisionSource,
} from '../entities/RiskConfigRevision.js';
import { presentRiskConfigForApi } from '../risk/risk-config-api.js';
import { computeCryptoAlgoConfigFingerprint } from '../crypto-algo/config-fingerprint.js';

export class RiskConfigRevisionService {
  constructor(private readonly ds: DataSource) {}

  async recordRevision(
    config: RiskConfig,
    options: {
      source?: RiskConfigRevisionSource;
      patch?: Record<string, unknown> | null;
      manager?: EntityManager;
    } = {},
  ): Promise<RiskConfigRevision> {
    const repo = (options.manager ?? this.ds.manager).getRepository(RiskConfigRevision);
    const presented = presentRiskConfigForApi(config);
    const row = repo.create({
      source: options.source ?? 'api',
      patchJson: options.patch ? JSON.stringify(options.patch) : null,
      configJson: JSON.stringify(presented),
      configFingerprint: computeCryptoAlgoConfigFingerprint(config),
    });
    return repo.save(row);
  }

  async getLatestFingerprint(): Promise<string | null> {
    const row = await this.ds.getRepository(RiskConfigRevision).findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });
    return row?.configFingerprint ?? null;
  }
}
