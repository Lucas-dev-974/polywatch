import { DataSource } from 'typeorm';
import pino from 'pino';
import {
  discoverWeatherMarkets,
  parseWeatherQuestion,
  normalizeWeatherCity,
  buildLookAheadTargetDates,
  type MarketListItemDto,
} from '@polywatch/core';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';
import type { WeatherMarketSelectionService } from './weather-market-selection.service.js';

const log = pino({ name: 'core:weather-auto-track' });

export type WeatherAutoTrackSyncResult = {
  disabled: number;
  added: number;
};

function marketMatchesRule(
  market: MarketListItemDto,
  rule: WeatherAutoTrackRule,
  targetDateStrs: Set<string>,
): boolean {
  if (!market.question) return false;
  const parsed = parseWeatherQuestion(market.question);
  if (!parsed) return false;
  if (normalizeWeatherCity(parsed.city) !== normalizeWeatherCity(rule.city)) {
    return false;
  }
  if (parsed.metric !== rule.metric) return false;

  const targetMonthDays = new Set(
    [...targetDateStrs].map((dateStr) => {
      const d = new Date(`${dateStr}T12:00:00Z`);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    }),
  );

  if (targetMonthDays.has(parsed.dateString)) return true;

  if (market.endDate) {
    const endStr = new Date(market.endDate).toISOString().slice(0, 10);
    if (targetDateStrs.has(endStr)) return true;
  }

  return false;
}

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
    mode?: 'expand' | 'city_follow',
  ): Promise<WeatherAutoTrackRule> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    const existing = await repo.findOne({ where: { city, metric } });
    if (existing) {
      existing.lookAheadDays = lookAheadDays;
      existing.enabled = true;
      if (mode) existing.mode = mode;
      return repo.save(existing);
    }
    const entry = repo.create({ city, metric, lookAheadDays, mode: mode ?? 'expand' });
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

  async syncMarketSelectionsForAutoTrack(
    selectionService: WeatherMarketSelectionService,
  ): Promise<WeatherAutoTrackSyncResult> {
    const rules = await this.loadAllEnabled();
    if (rules.length === 0) {
      return { disabled: 0, added: 0 };
    }

    const maxLookAhead = Math.max(...rules.map((r) => r.lookAheadDays ?? 1));
    const targetDates = buildLookAheadTargetDates(maxLookAhead);
    const targetDateStrs = new Set(
      targetDates.map((d) => d.toISOString().slice(0, 10)),
    );

    const discovery = await discoverWeatherMarkets({ targetDates, limit: 100 });
    const existing = await selectionService.loadAll();
    const existingIds = new Set(existing.map((s) => s.conditionId));

    let added = 0;
    for (const rule of rules) {
      // Skip city-follow rules — they don't materialize selections
      if (rule.mode === 'city_follow') continue;

      const ruleDates = buildLookAheadTargetDates(rule.lookAheadDays ?? 1);
      const ruleDateStrs = new Set(
        ruleDates.map((d) => d.toISOString().slice(0, 10)),
      );

      for (const market of discovery.temperatureMarkets) {
        if (!marketMatchesRule(market, rule, ruleDateStrs)) continue;
        if (existingIds.has(market.conditionId)) continue;

        await selectionService.addSelection(market.conditionId, {
          question: market.question ?? null,
          eventSlug: market.eventSlug ?? null,
        });
        existingIds.add(market.conditionId);
        added++;
        log.info(
          { city: rule.city, metric: rule.metric, conditionId: market.conditionId },
          'auto-track added weather market selection',
        );
      }
    }

    let disabled = 0;
    for (const sel of existing) {
      if (!sel.enabled) continue;
      const markets = discovery.temperatureMarkets.filter(
        (m) => m.conditionId === sel.conditionId,
      );
      const market = markets[0];
      if (market && !market.closed) continue;

      if (sel.targetDate && new Date(sel.targetDate).getTime() < Date.now()) {
        await selectionService.setEnabled(sel.conditionId, false);
        disabled++;
        continue;
      }

      if (market?.closed) {
        await selectionService.setEnabled(sel.conditionId, false);
        disabled++;
      }
    }

    log.info({ added, disabled, rules: rules.length }, 'weather auto-track sync completed');
    return { disabled, added };
  }
}
