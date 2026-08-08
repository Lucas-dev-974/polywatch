import pino from 'pino';
import type { DataSource } from 'typeorm';
import { WeatherForecastHistory } from '../entities/WeatherForecastHistory.js';

const log = pino({ name: 'core:weather-forecast-history-recorder' });
const BATCH_SIZE = 5_000;

export class WeatherForecastHistoryRecorder {
  constructor(private readonly ds: DataSource) {}

  async record(input: {
    city: string;
    forecastDate: Date;
    metric: string;
    forecastMean: number;
    forecastStdDev: number;
    modelValues: Record<string, number>;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    await this.ds.getRepository(WeatherForecastHistory).insert({
      city: input.city,
      forecastDate: input.forecastDate,
      metric: input.metric,
      forecastMean: input.forecastMean,
      forecastStdDev: input.forecastStdDev,
      modelValuesJson: JSON.stringify(input.modelValues),
      latitude: input.latitude,
      longitude: input.longitude,
      fetchedAt: new Date(),
    });
  }

  async purgeOlderThan(retentionMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    let totalDeleted = 0;

    for (;;) {
      const rows = await this.ds
        .getRepository(WeatherForecastHistory)
        .createQueryBuilder('h')
        .select('h.id', 'id')
        .where('h.fetchedAt < :cutoff', { cutoff })
        .orderBy('h.id', 'ASC')
        .limit(BATCH_SIZE)
        .getRawMany<{ id: number }>();

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) break;

      await this.ds
        .getRepository(WeatherForecastHistory)
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids })
        .execute();

      totalDeleted += ids.length;
      if (ids.length < BATCH_SIZE) break;
    }

    if (totalDeleted > 0) {
      log.info({ deletedRows: totalDeleted, cutoff }, 'purged weather_forecast_history');
    }
    return totalDeleted;
  }
}
