import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import pino from 'pino';
import {
  type OrderSignal,
  type WeatherConfig,
  type RedisQueue,
  type IPolymarketConnectionManager,
  type WeatherForecastService,
  type TotalCloseReason,
  CopiedPosition,
  WeatherPositionForecastService,
  buildCloseOrderSignal,
  shouldCloseForForecastDrift,
  shouldCloseForBucketExit,
  shouldEmitBucketExit,
  resolveCityFollowSwitchMode,
  setWeatherReentryThrottle,
  incrementWeatherBucketHysteresis,
  resetWeatherBucketHysteresis,
  getStrategyParams,
  resolveEnabledWeatherStrategies,
  WEATHER_FORECAST_STRATEGY_ID,
  WEATHER_HIGHEST_YES_STRATEGY_ID,
  isWeatherMetric,
  type WeatherMetric,
  type BucketBounds,
} from '@polywatch/core';
import { DEFAULT_REENTRY_THROTTLE_MS, CLOSE_QUEUE_DEDUPE_TTL_SECONDS } from '../constants.js';

const log = pino({ name: 'weather-algo:exit-evaluator' });

export interface WeatherExitEvaluatorParams {
  ds: DataSource;
  watchlistId: number;
  risk: WeatherConfig;
  forecastService: WeatherForecastService;
  positionForecastService: WeatherPositionForecastService;
  connectionManager: IPolymarketConnectionManager;
  closeQueue: RedisQueue<OrderSignal>;
  redisCmd: Redis;
}

export class WeatherExitEvaluator {
  private risk: WeatherConfig;

  constructor(private readonly params: WeatherExitEvaluatorParams) {
    this.risk = params.risk;
  }

  updateRiskConfig(risk: WeatherConfig): void {
    this.risk = risk;
  }

  async evaluateOpenPositions(): Promise<void> {
    const { ds, watchlistId } = this.params;
    const risk = this.risk;
    const repo = ds.getRepository(CopiedPosition);
    const positions = await repo.find({
      where: {
        watchlistId,
        status: 'open',
        reason: 'WEATHER_OPEN',
      },
    });

    const openPositions = positions.filter((p) => p.quantity > 0);
    if (openPositions.length === 0) return;

    log.info({ count: openPositions.length }, 'evaluating weather exit conditions');

    for (const pos of openPositions) {
      try {
        await this.evaluatePosition(pos, risk);
      } catch (err) {
        log.error({ err, positionId: pos.id }, 'weather exit evaluation failed');
      }
    }
  }

  private async evaluatePosition(
    pos: CopiedPosition,
    risk: WeatherConfig,
  ): Promise<void> {
    if (pos.status !== 'open') return;

    const snapshot = await this.params.positionForecastService.findByCopiedPositionId(
      pos.id,
    );
    if (!snapshot) {
      log.warn({ positionId: pos.id }, 'weather exit skipped — no entry forecast snapshot');
      return;
    }

    // Resolve per-strategy params from the position's originating strategy.
    // Legacy positions (strategyId = null) fall back to the catalogue defaults.
    const strategyId = snapshot.strategyId ?? pos.strategyId;
    if (!strategyId) {
      log.warn({ positionId: pos.id }, 'weather exit — legacy position without strategyId; using defaults');
    }
    const bag = getStrategyParams(
      risk,
      strategyId ?? resolveEnabledWeatherStrategies(risk)[0] ?? WEATHER_FORECAST_STRATEGY_ID,
    );

    // highest-yes holds until resolution: no forecast drift and no bucket-exit.
    // Skipping the forecast fetch also avoids a phantom close caused by the
    // persisted entryForecastMean=0 placeholder (drift would read 0 and fire).
    const isHighestYes = strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;

    let drift = false;
    let bucketExit = false;
    if (!isHighestYes) {
      if (!isWeatherMetric(snapshot.metric)) {
        log.warn(
          { positionId: pos.id, city: snapshot.city, metric: snapshot.metric },
          'weather exit checks skipped — invalid metric',
        );
        return;
      }
      const metric: WeatherMetric = snapshot.metric;
      const current = await this.params.forecastService.getOrFetch(
        snapshot.city,
        snapshot.targetDate,
        metric,
      );
      if (current == null) {
        log.warn(
          { positionId: pos.id, city: snapshot.city },
          'weather exit checks skipped — forecast unavailable',
        );
      } else {
        drift = shouldCloseForForecastDrift(
          snapshot.entryForecastMean,
          current.forecastMean,
          bag.forecastChangeThreshold,
        );

        if (!drift && snapshot.entryBucketComparison && snapshot.entryBucketBounds) {
          let bounds: BucketBounds | null = null;
          try {
            bounds = JSON.parse(snapshot.entryBucketBounds) as BucketBounds;
          } catch (err) {
            log.warn(
              { err, positionId: pos.id },
              'weather exit — invalid entryBucketBounds JSON; skipping bucket exit',
            );
          }
          if (bounds) {
            const leftBucket = shouldCloseForBucketExit(
              snapshot.entryBucketComparison as 'exact' | 'between' | 'or_below' | 'or_above',
              bounds,
              current.forecastMean,
            );
            const switchMode = resolveCityFollowSwitchMode(bag.cityFollowSwitchMode);
            const hysteresisPolls = bag.bucketHysteresisPolls;

            if (!leftBucket) {
              await resetWeatherBucketHysteresis(this.params.redisCmd, pos.id);
            } else {
              const consecutive = await incrementWeatherBucketHysteresis(
                this.params.redisCmd,
                pos.id,
              );
              bucketExit = shouldEmitBucketExit(
                switchMode,
                true,
                consecutive,
                hysteresisPolls,
              );
              if (leftBucket && switchMode === 'hold') {
                log.debug(
                  { positionId: pos.id, consecutive },
                  'bucket left but switch mode=hold — not closing',
                );
              } else if (leftBucket && !bucketExit) {
                log.debug(
                  { positionId: pos.id, consecutive, hysteresisPolls },
                  'bucket left — waiting for hysteresis',
                );
              }
            }
          }
        }
      }
    }

    if (!drift && !bucketExit) return;

    const reason: TotalCloseReason = drift
      ? 'WEATHER_FORECAST_CHANGE'
      : 'WEATHER_BUCKET_EXIT';

    const prices = await this.params.connectionManager.fetchExecutablePrices(
      pos.assetId,
      pos.quantity,
    );
    const bidVwap = prices.executableBidVwap;
    if (bidVwap <= 0) {
      log.warn(
        { positionId: pos.id, reason },
        'weather exit deferred — no executable bid',
      );
      return;
    }

    const fresh = await this.params.ds.getRepository(CopiedPosition).findOne({
      where: { id: pos.id },
    });
    if (!fresh || fresh.status !== 'open') return;

    const signal = buildCloseOrderSignal({
      pos: {
        id: fresh.id,
        mode: fresh.mode,
        conditionId: fresh.conditionId,
        assetId: fresh.assetId,
        quantity: fresh.quantity,
        entryPrice: fresh.entryPrice,
        executableBidVwap: fresh.executableBidVwap,
        closingAttemptSeq: fresh.closingAttemptSeq,
      },
      reason,
      bidVwap,
    });

    await this.params.closeQueue.enqueueUnique(
      signal,
      `weather-close:${pos.id}:${reason}`,
      CLOSE_QUEUE_DEDUPE_TTL_SECONDS,
    );

    if (reason === 'WEATHER_BUCKET_EXIT' || reason === 'WEATHER_FORECAST_CHANGE') {
      const throttleMs = bag.reentryThrottleMs ?? DEFAULT_REENTRY_THROTTLE_MS;
      await setWeatherReentryThrottle(
        this.params.redisCmd,
        snapshot.city,
        snapshot.targetDate.toISOString().slice(0, 10),
        fresh.mode as 'sim' | 'real',
        throttleMs,
      );
      await resetWeatherBucketHysteresis(this.params.redisCmd, pos.id);
    }

    log.info(
      {
        positionId: pos.id,
        reason,
        bidVwap,
        city: snapshot.city,
      },
      'weather exit close signal enqueued',
    );
  }
}
