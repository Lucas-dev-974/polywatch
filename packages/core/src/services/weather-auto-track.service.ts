import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';
import type { WeatherMarketSelectionService } from './weather-market-selection.service.js';

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
    metric: string = 'highest_temp',
    lookAheadDays: number = 1,
    mode?: 'city_follow',
  ): Promise<WeatherAutoTrackRule> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    const resolvedMetric = metric || 'highest_temp';
    const resolvedMode = mode ?? 'city_follow';
    const normalizedCity = city.trim();
    const existing = await repo
      .createQueryBuilder('r')
      .where('LOWER(TRIM(r.city)) = LOWER(:city)', { city: normalizedCity })
      .andWhere('r.metric = :metric', { metric: resolvedMetric })
      .getOne();
    if (existing) {
      existing.city = normalizedCity;
      existing.lookAheadDays = lookAheadDays;
      existing.enabled = true;
      existing.mode = resolvedMode;
      existing.metric = resolvedMetric;
      return repo.save(existing);
    }
    const entry = repo.create({
      city: normalizedCity,
      metric: resolvedMetric,
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
   * City-first: no longer materializes per-market selections.
   * Disables stale/closed selection rows left over from expand mode.
   */
  async syncMarketSelectionsForAutoTrack(
    selectionService: WeatherMarketSelectionService,
  ): Promise<WeatherAutoTrackSyncResult> {
    const existing = await selectionService.loadAll();
    let disabled = 0;
    for (const sel of existing) {
      if (!sel.enabled) continue;
      await selectionService.setEnabled(sel.conditionId, false);
      disabled++;
    }
    if (disabled > 0) {
      log.info({ disabled }, 'weather auto-track cleanup disabled legacy market selections');
    }
    return { disabled, added: 0 };
  }
}
