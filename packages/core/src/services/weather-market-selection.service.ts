import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherMarketSelection } from '../entities/WeatherMarketSelection.js';
import { MarketService } from './market.service.js';
import { parseWeatherQuestion } from '../weather/question-parser.js';

const log = pino({ name: 'core:weather-market-selection' });

export interface WeatherSelectionMeta {
  question?: string | null;
  eventSlug?: string | null;
  city?: string | null;
  targetDate?: Date | null;
  metric?: string | null;
  targetValue?: number | null;
}

export class WeatherMarketSelectionService {
  constructor(private readonly ds: DataSource) {}

  async loadAll(): Promise<WeatherMarketSelection[]> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    return repo.find({ order: { createdAt: 'ASC' } });
  }

  async loadAllEnabled(): Promise<WeatherMarketSelection[]> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    return repo.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
  }

  async loadByEventSlug(eventSlug: string): Promise<WeatherMarketSelection[]> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    return repo.find({ where: { eventSlug, enabled: true } });
  }

  async addSelection(
    conditionId: string,
    meta: WeatherSelectionMeta,
  ): Promise<WeatherMarketSelection> {
    const repo = this.ds.getRepository(WeatherMarketSelection);

    // Enrich metadata from the persisted market if available
    const marketService = new MarketService(this.ds);
    const enriched = await this.enrichFromMarket(conditionId, meta, marketService);

    return this.ds.manager.transaction(async (em) => {
      const txRepo = em.getRepository(WeatherMarketSelection);
      const existing = await txRepo.findOne({
        where: { conditionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        Object.assign(existing, { ...enriched, enabled: true });
        return txRepo.save(existing);
      }
      const entry = txRepo.create({ conditionId, ...enriched });
      return txRepo.save(entry);
    });
  }

  private async enrichFromMarket(
    conditionId: string,
    meta: WeatherSelectionMeta,
    marketService: MarketService,
  ): Promise<WeatherSelectionMeta> {
    const result: WeatherSelectionMeta = { ...meta };
    try {
      const market = await marketService.ensureTradableMarket(conditionId);
      if (!market) return result;

      if (!result.targetDate && market.endDate) {
        result.targetDate = market.endDate;
      }
      if (!result.question && market.question) {
        result.question = market.question;
      }
      if (!result.city || !result.metric || result.targetValue == null) {
        const parsed = market.question
          ? parseWeatherQuestion(market.question)
          : null;
        if (parsed) {
          result.city = result.city ?? parsed.city;
          result.metric = result.metric ?? parsed.metric;
          if (result.targetValue == null) {
            result.targetValue = parsed.targetValue;
          }
          if (parsed.comparison === 'between' && result.targetValue == null) {
            // For between, store the midpoint as targetValue
            const low = parsed.targetValueLow ?? 0;
            const high = parsed.targetValueHigh ?? 0;
            result.targetValue = Math.round((low + high) / 2 * 10) / 10;
          }
        }
      }
    } catch (err) {
      log.warn({ err, conditionId }, 'failed to enrich weather selection from market');
    }
    return result;
  }

  async removeSelection(conditionId: string): Promise<void> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    await repo.delete({ conditionId });
  }

  async setEnabled(conditionId: string, enabled: boolean): Promise<void> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    await repo.update({ conditionId }, { enabled });
  }

  async ensureMarketsForEnabledSelections(): Promise<void> {
    // Placeholder — the weather-algo package will override market fetching.
    // This mirrors AlgoMarketSelectionService.ensureMarketsForEnabledSelections.
  }

  async getStatusCounts(): Promise<{
    enabledSelections: number;
    selectionsWithMarket: number;
  }> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    const enabledSelections = await repo.count({ where: { enabled: true } });
    return {
      enabledSelections,
      selectionsWithMarket: enabledSelections,
    };
  }
}