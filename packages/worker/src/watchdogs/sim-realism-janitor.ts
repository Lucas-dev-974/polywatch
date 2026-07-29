import type { DataSource } from 'typeorm';
import { ClobLatencySample, GlobalConfigService, ShadowFill } from '@polywatch/core';
import { resolveSimExecutionTunables } from '@polywatch/core';
import pino from 'pino';
import { safeInterval } from '../helpers.js';

const log = pino({ name: 'sim-realism-janitor' });

export class SimRealismJanitor {
  constructor(private readonly ds: DataSource) {}

  async run(): Promise<void> {
    const global = await new GlobalConfigService(this.ds).getConfig();
    const tunables = resolveSimExecutionTunables(global);
    const days = tunables.shadowSampleRetentionDays;
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const [latency, shadow] = await Promise.all([
      this.ds
        .getRepository(ClobLatencySample)
        .createQueryBuilder()
        .delete()
        .where('created_at < :cutoff', { cutoff })
        .execute(),
      this.ds
        .getRepository(ShadowFill)
        .createQueryBuilder()
        .delete()
        .where('created_at < :cutoff', { cutoff })
        .execute(),
    ]);

    const total = (latency.affected ?? 0) + (shadow.affected ?? 0);
    if (total > 0) {
      log.info(
        { latencyDeleted: latency.affected, shadowDeleted: shadow.affected, days },
        'sim realism samples purged',
      );
    }
  }

  start(intervalMs = 3_600_000): NodeJS.Timeout {
    return safeInterval(() => this.run(), intervalMs, 'sim-realism-janitor');
  }
}
