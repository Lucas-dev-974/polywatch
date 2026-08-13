import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';
import type { WeatherMetric } from '../weather/metric.js';

const log = pino({ name: 'core:weather-auto-track' });

export type WeatherAutoTrackSyncResult = {
  disabled: number;
  added: number;
};

export class WeatherAutoTrackService {
  constructor(private readonly ds: DataSource) {}

  async loadAll(): Promise<WeatherAutoTrackRule[]> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    return repo.find({ order: { city: 'ASC' } });
  }

  async loadAllEnabled(): Promise<WeatherAutoTrackRule[]> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    return repo.find({ where: { enabled: true }, order: { city: 'ASC' } });
  }

  async addRule(
    city: string,
    metric: WeatherMetric = 'highest_temp',
    lookAheadDays: number = 1,
    mode?: 'city_follow',
  ): Promise<WeatherAutoTrackRule> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    const resolvedMode = mode ?? 'city_follow';
    const normalizedCity = city.trim();
    const existing = await repo
      .createQueryBuilder('r')
      .where('LOWER(TRIM(r.city)) = LOWER(:city)', { city: normalizedCity })
      .andWhere('r.metric = :metric', { metric })
      .getOne();
    if (existing) {
      existing.city = normalizedCity;
      existing.lookAheadDays = lookAheadDays;
      existing.enabled = true;
      existing.mode = resolvedMode;
      existing.metric = metric;
      return repo.save(existing);
    }
    const entry = repo.create({
      city: normalizedCity,
      metric,
      lookAheadDays,
      mode: resolvedMode,
    });
    return repo.save(entry);
  }

  async removeRule(id: number): Promise<void> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    await repo.delete({ id });
  }

  async setEnabled(id: number, enabled: boolean): Promise<void> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    await repo.update({ id }, { enabled });
  }

  async updateRule(
    id: number,
    patch: { enabled?: boolean; lookAheadDays?: number },
  ): Promise<WeatherAutoTrackRule | null> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    const rule = await repo.findOne({ where: { id } });
    if (!rule) return null;
    if (patch.enabled !== undefined) rule.enabled = patch.enabled;
    if (patch.lookAheadDays !== undefined) {
      rule.lookAheadDays = Math.max(1, Math.min(30, Math.floor(patch.lookAheadDays)));
    }
    return repo.save(rule);
  }

  /**
   * City-first: legacy per-market selections have been removed.
   * This is a no-op kept for backward compatibility with the janitor cycle.
   */
  async syncMarketSelectionsForAutoTrack(): Promise<WeatherAutoTrackSyncResult> {
    return { disabled: 0, added: 0 };
  }
}
