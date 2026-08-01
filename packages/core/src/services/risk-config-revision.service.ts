import type { DataSource, EntityManager } from 'typeorm';
import { AnalysisReport } from '../entities/AnalysisReport.js';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { GlobalConfig } from '../entities/GlobalConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import {
  RiskConfigRevision,
  type RiskConfigRevisionSource,
} from '../entities/RiskConfigRevision.js';
import { computeCryptoAlgoConfigFingerprint } from '../crypto-algo/config-fingerprint.js';

export type ConfigKind = 'global' | 'copy' | 'crypto' | 'weather';

export class RiskConfigRevisionService {
  constructor(private readonly ds: DataSource) {}

  async recordRevision(
    config: GlobalConfig | CopyConfig | CryptoConfig | WeatherConfig,
    options: {
      source?: RiskConfigRevisionSource;
      patch?: Record<string, unknown> | null;
      manager?: EntityManager;
      kind?: ConfigKind;
    } = {},
  ): Promise<RiskConfigRevision> {
    const repo = (options.manager ?? this.ds.manager).getRepository(RiskConfigRevision);
    const kind = options.kind ?? 'global';

    let configJson: string;
    let fingerprint: string | null;

    if (kind === 'crypto' && 'cryptoAlgoEnabled' in config) {
      // CryptoConfig: present as-is (fingerprint on crypto fields only)
      configJson = JSON.stringify(config);
      fingerprint = computeCryptoAlgoConfigFingerprint(config as CryptoConfig);
    } else if (kind === 'global' && 'maxSlippagePercent' in config) {
      // GlobalConfig: just serialize
      configJson = JSON.stringify(config);
      fingerprint = '';
    } else if (kind === 'copy' && 'simCopyTradingEnabled' in config) {
      configJson = JSON.stringify(config);
      fingerprint = '';
    } else if (kind === 'weather' && 'weatherAlgoEnabled' in config) {
      configJson = JSON.stringify(config);
      fingerprint = '';
    } else {
      // Fallback for unknown/legacy shapes
      configJson = JSON.stringify(config);
      fingerprint = '';
    }

    const row = repo.create({
      source: options.source ?? 'api',
      patchJson: options.patch ? JSON.stringify(options.patch) : null,
      configJson,
      configFingerprint: fingerprint,
      configKind: kind,
    });
    return repo.save(row);
  }

  async getLatestFingerprint(kind?: ConfigKind): Promise<string | null> {
    const where = kind ? { configKind: kind } : {};
    const row = await this.ds.getRepository(RiskConfigRevision).findOne({
      where,
      order: { createdAt: 'DESC' },
    });
    return row?.configFingerprint ?? null;
  }
}
