import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';

const log = pino({ name: 'core:weather-auto-track' });

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
    metric: string,
    lookAheadDays: number = 1,
  ): Promise<WeatherAutoTrackRule> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    const existing = await repo.findOne({ where: { city, metric } });
    if (existing) {
      existing.lookAheadDays = lookAheadDays;
      existing.enabled = true;
      return repo.save(existing);
    }
    const entry = repo.create({ city, metric, lookAheadDays });
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
}