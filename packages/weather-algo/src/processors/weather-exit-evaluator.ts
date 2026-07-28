import type { DataSource } from 'typeorm';
import pino from 'pino';
import {
  type OrderSignal,
  type RiskConfig,
  type RedisQueue,
  type IPolymarketConnectionManager,
  type MarketService,
  type WeatherForecastService,
  type TotalCloseReason,
  CopiedPosition,
  WeatherPositionForecastService,
  buildCloseOrderSignal,
  shouldCloseForForecastDrift,
  shouldCloseBeforeResolution,
  shouldCloseForBucketExit,
  type BucketBounds,
} from '@polywatch/core';

const log = pino({ name: 'weather-algo:exit-evaluator' });

export interface WeatherExitEvaluatorParams {
  ds: DataSource;
  watchlistId: number;
  risk: RiskConfig;
  forecastService: WeatherForecastService;
  positionForecastService: WeatherPositionForecastService;
  marketService: MarketService;
  connectionManager: IPolymarketConnectionManager;
  closeQueue: RedisQueue<OrderSignal>;
}

export class WeatherExitEvaluator {
  private risk: RiskConfig;

  constructor(private readonly params: WeatherExitEvaluatorParams) {
    this.risk = params.risk;
  }

  updateRiskConfig(risk: RiskConfig): void {
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
    risk: RiskConfig,
  ): Promise<void> {
    if (pos.status !== 'open') return;

    const snapshot = await this.params.positionForecastService.findByCopiedPositionId(
      pos.id,
    );
    if (!snapshot) {
      log.warn({ positionId: pos.id }, 'weather exit skipped — no entry forecast snapshot');
      return;
    }

    const markets = await this.params.marketService.loadByConditionIds([pos.conditionId]);
    const market = markets.get(pos.conditionId);
    const endDate = market?.endDate ? new Date(market.endDate) : null;
    const hoursToEnd = endDate
      ? (endDate.getTime() - Date.now()) / 3_600_000
      : Number.POSITIVE_INFINITY;

    const closeBeforeHours = risk.weatherAlgoCloseBeforeResolutionHours ?? 1;
    const preClose = shouldCloseBeforeResolution(hoursToEnd, closeBeforeHours);

    let drift = false;
    let bucketExit = false;
    if (!preClose) {
      const current = await this.params.forecastService.getOrFetch(
        snapshot.city,
        snapshot.targetDate,
        snapshot.metric as 'highest_temp' | 'lowest_temp',
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
          risk.weatherAlgoForecastChangeThreshold ?? 2,
        );

        if (!drift && snapshot.entryBucketComparison && snapshot.entryBucketBounds) {
          const bounds = JSON.parse(snapshot.entryBucketBounds) as BucketBounds;
          bucketExit = shouldCloseForBucketExit(
            snapshot.entryBucketComparison as 'exact' | 'between' | 'or_below' | 'or_above',
            bounds,
            current.forecastMean,
          );
        }
      }
    }

    if (!preClose && !drift && !bucketExit) return;

    const reason: TotalCloseReason = preClose
      ? 'WEATHER_PRE_CLOSE'
      : drift
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

    await this.params.closeQueue.enqueue(signal);
    log.info(
      {
        positionId: pos.id,
        reason,
        hoursToEnd: Number.isFinite(hoursToEnd) ? hoursToEnd.toFixed(2) : null,
        bidVwap,
      },
      'weather exit close signal enqueued',
    );
  }

}
