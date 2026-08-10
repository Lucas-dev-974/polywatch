import pino from 'pino';
import type { DataSource } from 'typeorm';
import { In } from 'typeorm';
import type { MarketListItemDto } from '../polymarket/market-list.js';
import { binaryPricesFromParsed } from '../polymarket/outcome-tokens.js';
import { fetchPriceHistory } from '../polymarket/price-history-client.js';
import { fetchGammaMarket } from '../polymarket/market-metadata.js';
import { parseWeatherQuestion } from '../weather/question-parser.js';
import {
  discoverWeatherMarketsInRange,
  resolveMarketTargetDateIso,
} from '../weather/weather-market-discovery.js';
import { WeatherClobPriceHistory } from '../entities/WeatherClobPriceHistory.js';
import {
  WeatherHistoryIngestJob,
  type WeatherHistoryIngestJobStatus,
} from '../entities/WeatherHistoryIngestJob.js';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';
import { WeatherMarketSnapshot } from '../entities/WeatherMarketSnapshot.js';

const log = pino({ name: 'weather-history-ingest' });

const ACTIVE_JOB_STATUSES: WeatherHistoryIngestJobStatus[] = ['pending', 'running'];
const CLOB_THROTTLE_MS = 250;
const UPSERT_CHUNK_SIZE = 500;

export class WeatherHistoryIngestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherHistoryIngestConflictError';
  }
}

export interface StartWeatherHistoryIngestInput {
  city: string;
  from: Date;
  to: Date;
  fidelityMinutes: number;
  metric?: 'highest_temp' | 'lowest_temp';
}

export interface WeatherHistoryIngestJobDto {
  id: number;
  city: string;
  metric: string;
  fromDate: string;
  toDate: string;
  fidelityMinutes: number;
  status: WeatherHistoryIngestJobStatus;
  marketsTotal: number;
  marketsDone: number;
  marketsEmpty: number;
  pointsUpserted: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WeatherHistoryCoverageDto {
  city: string;
  pointCount: number;
  fromRecordedAt: string | null;
  toRecordedAt: string | null;
  targetDates: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toJobDto(job: WeatherHistoryIngestJob): WeatherHistoryIngestJobDto {
  return {
    id: job.id,
    city: job.city,
    metric: job.metric,
    fromDate: job.fromDate,
    toDate: job.toDate,
    fidelityMinutes: job.fidelityMinutes,
    status: job.status,
    marketsTotal: job.marketsTotal,
    marketsDone: job.marketsDone,
    marketsEmpty: job.marketsEmpty,
    pointsUpserted: job.pointsUpserted,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}

function normalizeCity(city: string): string {
  return city.trim();
}

function formatTargetDateIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s;
}

function toUtcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Detect the resolved side of a weather market.
 * Returns 'YES' or 'NO' when a winner is identifiable, else null.
 *
 * /prices-history only returns CLOB trade prices, never the post-settlement
 * payoff (1.00 / 0.00 fixed by the oracle). For resolved markets we therefore
 * synthesize a final point at the settlement price so the winning bucket's
 * YES reaches 1.00 in the recorded history.
 *
 * Strategy:
 *  1. Fast path — if the market is clearly settled (closed AND no longer
 *     accepting orders) and carries outcomePrices (Gamma /events), use them.
 *     We gate on closed/acceptingOrders here because a live market can trade
 *     at 0.99 without being resolved; injecting a fake 1.00 would corrupt data.
 *  2. Slow path — for closed markets, fetch the market from CLOB/Gamma via
 *     fetchGammaMarket and resolve the winner from winningTokenId (price ≥
 *     threshold), which is only populated by the settlement oracle. This is the
 *     authoritative signal and does not need the flag gate.
 */
const SETTLEMENT_PRICE_THRESHOLD = 0.99;

function resolveSideFromOutcomePrices(
  market: Pick<MarketListItemDto, 'outcomePrices' | 'tokenIdYes' | 'tokenIdNo'>,
): 'YES' | 'NO' | null {
  if (market.outcomePrices.length === 0) return null;
  const binary = binaryPricesFromParsed(market.outcomePrices);
  const yes = binary.side0?.price ?? null;
  const no = binary.side1?.price ?? null;
  if (yes != null && yes >= SETTLEMENT_PRICE_THRESHOLD) return 'YES';
  if (no != null && no >= SETTLEMENT_PRICE_THRESHOLD) return 'NO';
  return null;
}

async function detectResolvedSide(
  market: MarketListItemDto,
): Promise<'YES' | 'NO' | null> {
  // Fast path: only trust outcomePrices when the market is clearly settled.
  // A live market can trade at 0.99 without being resolved.
  if (market.closed && market.acceptingOrders !== true) {
    const fromPrices = resolveSideFromOutcomePrices(market);
    if (fromPrices) return fromPrices;
  }

  // Slow path: fetch the market record and resolve the winner from the
  // settlement oracle. We do NOT gate on market.closed here — Gamma does not
  // consistently flip `closed` for weather markets even after the outcome is
  // known, and discoverWeatherMarketsInRange can hand us a resolved market
  // with closed=false. The authoritative signal is gamma.resolved, which is
  // only true once the oracle has settled the market.
  try {
    const gamma = await fetchGammaMarket(market.conditionId);
    if (!gamma) return null;
    // Guard against a live market trading at 0.99: winningTokenId is derived
    // from a price threshold and would be populated even before settlement.
    if (!gamma.resolved) return null;
    const winner = gamma.winningTokenId;
    if (winner) {
      if (winner === market.tokenIdYes) return 'YES';
      if (winner === market.tokenIdNo) return 'NO';
    }
    // Fallback: use outcomePrices from the freshly fetched record.
    return resolveSideFromOutcomePrices({
      tokenIdYes: market.tokenIdYes,
      tokenIdNo: market.tokenIdNo,
      outcomePrices: gamma.outcomePricesParsed,
    });
  } catch (err) {
    log.warn(
      { err, conditionId: market.conditionId },
      'detectResolvedSide: fetchGammaMarket failed',
    );
    return null;
  }
}

/**
 * Append a synthetic settlement point to a /prices-history series.
 *
 * The CLOB /prices-history endpoint only returns trade prices, never the
 * post-settlement payoff fixed by the oracle (1.00 for the winning side,
 * 0.00 for the losing side). To make the recorded history complete — so the
 * winning bucket's YES reaches 1.00 — we append one final point at the
 * settlement price.
 *
 * The settlement point is timestamped AFTER the last trade in the series
 * (never before it), so it is always the final point of the curve. Using the
 * market's endDate alone is wrong: trades can continue past endDate, which
 * would bury the 1.00 point in the middle of the series.
 */
function appendSettlementPoint(
  points: { t: number; p: number }[],
  settlementTs: number,
  settlementPrice: number,
): { t: number; p: number }[] {
  if (!Number.isFinite(settlementTs)) return points;
  const lastTradeTs = points.length > 0 ? points[points.length - 1]!.t : 0;
  const finalTs = Math.max(settlementTs, lastTradeTs) + 1;
  return [...points, { t: finalTs, p: settlementPrice }];
}

/**
 * Extra window added past a weather market's endDate when fetching /prices-history.
 * Weather markets only settle after the official weather result is published,
 * so the winning bucket's YES jumps to 1.00 slightly after endDate. Without this
 * margin the resolution point is cut off and no bucket ever reaches 1.00.
 */
const RESOLUTION_MARGIN_SEC = 48 * 3600;

function resolveMarketEndTs(market: MarketListItemDto): number {
  if (market.endDate) {
    const end = Math.floor(new Date(market.endDate).getTime() / 1000);
    if (Number.isFinite(end)) return end + RESOLUTION_MARGIN_SEC;
  }
  return Math.floor(Date.now() / 1000);
}

/** Fallback lookback when a market has no usable startDate (weather markets open ~2-3 days before close). */
const DEFAULT_START_LOOKBACK_SEC = 7 * 24 * 3600;

function resolveMarketStartTs(market: MarketListItemDto, endTs: number): number {
  if (market.startDate) {
    const start = Math.floor(new Date(market.startDate).getTime() / 1000);
    if (Number.isFinite(start) && start < endTs) return start;
  }
  // The CLOB API rejects requests with endTs but no startTs (HTTP 400), so
  // always provide a bounded window.
  return endTs - DEFAULT_START_LOOKBACK_SEC;
}

export class WeatherHistoryIngestService {
  constructor(private readonly ds: DataSource) {}

  private jobRepo() {
    return this.ds.getRepository(WeatherHistoryIngestJob);
  }

  private historyRepo() {
    return this.ds.getRepository(WeatherClobPriceHistory);
  }

  async markInterruptedJobs(): Promise<number> {
    const result = await this.jobRepo()
      .createQueryBuilder()
      .update()
      .set({
        status: 'error',
        errorMessage: 'interrupted',
        finishedAt: new Date(),
      })
      .where('status IN (:...statuses)', { statuses: ACTIVE_JOB_STATUSES })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Mark as error any job stuck in an active status beyond maxAgeMs.
   * Intended to be called periodically to recover from a mid-ingest crash
   * (kill -9 / OOM) that left a job running without ever updating its status,
   * which would otherwise permanently block the city via the conflict guard.
   */
  async markStaleJobs(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await this.jobRepo()
      .createQueryBuilder()
      .update()
      .set({
        status: 'error',
        errorMessage: 'stale_timeout',
        finishedAt: new Date(),
      })
      .where('status IN (:...statuses)', { statuses: ACTIVE_JOB_STATUSES })
      .andWhere('started_at IS NOT NULL')
      .andWhere('started_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  async listKnownCities(): Promise<string[]> {
    const [autoTrack, snapshots, history] = await Promise.all([
      this.ds.getRepository(WeatherAutoTrackRule).find({ select: ['city'] }),
      this.ds
        .getRepository(WeatherMarketSnapshot)
        .createQueryBuilder('s')
        .select('DISTINCT s.city', 'city')
        .getRawMany<{ city: string }>(),
      this.historyRepo()
        .createQueryBuilder('h')
        .select('DISTINCT h.city', 'city')
        .getRawMany<{ city: string }>(),
    ]);

    const seen = new Map<string, string>();
    for (const row of [...autoTrack, ...snapshots, ...history]) {
      const display = normalizeCity(row.city);
      if (!display) continue;
      const key = display.toLowerCase();
      if (!seen.has(key)) seen.set(key, display);
    }

    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }

  async getCoverage(city: string): Promise<WeatherHistoryCoverageDto> {
    const cityNormalized = normalizeCity(city).toLowerCase();
    const qb = this.historyRepo()
      .createQueryBuilder('h')
      .where('LOWER(h.city) = :city', { city: cityNormalized });

    const count = await qb.clone().getCount();
    if (count === 0) {
      return {
        city: normalizeCity(city),
        pointCount: 0,
        fromRecordedAt: null,
        toRecordedAt: null,
        targetDates: [],
      };
    }

    const bounds = await qb
      .clone()
      .select('MIN(h.recorded_at)', 'minAt')
      .addSelect('MAX(h.recorded_at)', 'maxAt')
      .getRawOne<{ minAt: Date; maxAt: Date }>();

    const targetDates = await this.historyRepo()
      .createQueryBuilder('h')
      .select('DISTINCT h.target_date', 'targetDate')
      .where('LOWER(h.city) = :city', { city: cityNormalized })
      .orderBy('h.target_date', 'ASC')
      .getRawMany<{ targetDate: string }>();

    return {
      city: normalizeCity(city),
      pointCount: count,
      fromRecordedAt: bounds?.minAt ? new Date(bounds.minAt).toISOString() : null,
      toRecordedAt: bounds?.maxAt ? new Date(bounds.maxAt).toISOString() : null,
      targetDates: targetDates.map((r) => formatTargetDateIso(r.targetDate)),
    };
  }

  async listJobs(limit = 20): Promise<WeatherHistoryIngestJobDto[]> {
    const rows = await this.jobRepo().find({
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    return rows.map(toJobDto);
  }

  async getJob(jobId: number): Promise<WeatherHistoryIngestJobDto | null> {
    const job = await this.jobRepo().findOne({ where: { id: jobId } });
    return job ? toJobDto(job) : null;
  }

  async startIngest(input: StartWeatherHistoryIngestInput): Promise<WeatherHistoryIngestJobDto> {
    const city = normalizeCity(input.city);
    if (!city) {
      throw new Error('city_required');
    }

    const fidelityMinutes = Math.max(1, Math.min(Math.floor(input.fidelityMinutes), 1440));
    const metric = input.metric ?? 'highest_temp';
    const fromDate = toUtcDateOnly(input.from);
    const toDate = toUtcDateOnly(input.to);
    if (fromDate > toDate) {
      throw new Error('invalid_date_range');
    }

    const active = await this.jobRepo().findOne({
      where: {
        city,
        status: In(ACTIVE_JOB_STATUSES),
      },
    });
    if (active) {
      throw new WeatherHistoryIngestConflictError(
        `Un chargement est déjà en cours pour ${city} (job #${active.id})`,
      );
    }

    const job = await this.jobRepo().save(
      this.jobRepo().create({
        city,
        metric,
        fromDate,
        toDate,
        fidelityMinutes,
        status: 'pending',
      }),
    );

    return toJobDto(job);
  }

  async runJob(jobId: number): Promise<void> {
    const job = await this.jobRepo().findOne({ where: { id: jobId } });
    if (!job) return;

    if (job.status !== 'pending') {
      log.debug({ jobId, status: job.status }, 'skip runJob — not pending');
      return;
    }

    await this.jobRepo().update(jobId, {
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
    });

    try {
      const from = new Date(`${job.fromDate}T00:00:00.000Z`);
      const to = new Date(`${job.toDate}T00:00:00.000Z`);
      const metric = job.metric as 'highest_temp' | 'lowest_temp';

      const { markets } = await discoverWeatherMarketsInRange({
        city: job.city,
        from,
        to,
        metric,
      });

      await this.jobRepo().update(jobId, { marketsTotal: markets.length });

      let marketsDone = 0;
      let marketsEmpty = 0;
      let pointsUpserted = 0;

      for (const market of markets) {
        const result = await this.ingestMarketHistory(
          market,
          job.id,
          job.city,
          metric,
          job.fidelityMinutes,
        );
        marketsDone += 1;
        if (result.emptySides > 0) marketsEmpty += 1;
        pointsUpserted += result.pointsUpserted;

        await this.jobRepo().update(jobId, {
          marketsDone,
          marketsEmpty,
          pointsUpserted,
        });
      }

      await this.jobRepo().update(jobId, {
        status: 'done',
        finishedAt: new Date(),
        marketsDone,
        marketsEmpty,
        pointsUpserted,
      });

      log.info(
        { jobId, marketsDone, marketsEmpty, pointsUpserted },
        'weather history ingest complete',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err, jobId }, 'weather history ingest failed');
      await this.jobRepo().update(jobId, {
        status: 'error',
        errorMessage: message,
        finishedAt: new Date(),
      });
    }
  }

  private async ingestMarketHistory(
    market: MarketListItemDto,
    jobId: number,
    city: string,
    metric: string,
    fidelityMinutes: number,
  ): Promise<{ pointsUpserted: number; emptySides: number }> {
    const parsed = market.question ? parseWeatherQuestion(market.question) : null;
    const targetDate = resolveMarketTargetDateIso(market);
    if (!targetDate || !parsed) {
      return { pointsUpserted: 0, emptySides: 1 };
    }

    const endTs = resolveMarketEndTs(market);
    const startTs = resolveMarketStartTs(market, endTs);
    const sides: Array<{ side: 'YES' | 'NO'; tokenId: string | null }> = [
      { side: 'YES', tokenId: market.tokenIdYes },
      { side: 'NO', tokenId: market.tokenIdNo },
    ];

    const resolvedSide = await detectResolvedSide(market);
    const settlementTs = market.endDate
      ? Math.floor(new Date(market.endDate).getTime() / 1000)
      : endTs;

    log.debug(
      {
        conditionId: market.conditionId,
        question: market.question,
        closed: market.closed,
        acceptingOrders: market.acceptingOrders,
        outcomePrices: market.outcomePrices,
        outcomePricesLen: market.outcomePrices.length,
        tokenIdYes: market.tokenIdYes,
        tokenIdNo: market.tokenIdNo,
        resolvedSide,
        endDate: market.endDate,
      },
      'ingestMarketHistory resolution diagnostic',
    );

    let pointsUpserted = 0;
    let emptySides = 0;

    for (const { side, tokenId } of sides) {
      if (!tokenId) {
        emptySides += 1;
        continue;
      }

      let points = await fetchPriceHistory({
        assetId: tokenId,
        startTs,
        endTs,
        fidelity: fidelityMinutes,
      });

      // /prices-history never returns the post-settlement payoff (1.00/0.00).
      // For a closed+resolved market, append a synthetic final point so the
      // winning bucket's YES reaches 1.00 and the losing side reaches 0.00.
      if (resolvedSide) {
        const settlementPrice = side === resolvedSide ? 1 : 0;
        points = appendSettlementPoint(points, settlementTs, settlementPrice);
      }

      if (points.length === 0) {
        log.debug(
          {
            conditionId: market.conditionId,
            tokenId,
            startTs: new Date(startTs * 1000).toISOString(),
            endTs: new Date(endTs * 1000).toISOString(),
            fidelity: fidelityMinutes,
          },
          'price history empty for token',
        );
      }

      await sleep(CLOB_THROTTLE_MS);

      if (points.length === 0) {
        emptySides += 1;
        continue;
      }

      const upserted = await this.upsertPoints({
        city,
        targetDate,
        metric,
        market,
        parsed,
        side,
        tokenId,
        fidelityMinutes,
        jobId,
        points,
      });
      pointsUpserted += upserted;
    }

    return { pointsUpserted, emptySides: emptySides >= 2 ? 1 : 0 };
  }

  private async upsertPoints(input: {
    city: string;
    targetDate: string;
    metric: string;
    market: MarketListItemDto;
    parsed: NonNullable<ReturnType<typeof parseWeatherQuestion>>;
    side: 'YES' | 'NO';
    tokenId: string;
    fidelityMinutes: number;
    jobId: number;
    points: { t: number; p: number }[];
  }): Promise<number> {
    let attempted = 0;
    let chunksFailed = 0;
    let firstError: string | null = null;

    for (let i = 0; i < input.points.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = input.points.slice(i, i + UPSERT_CHUNK_SIZE);
      const rows = chunk.map((pt) => ({
        city: input.city,
        targetDate: input.targetDate,
        metric: input.metric,
        conditionId: input.market.conditionId,
        eventSlug: input.market.eventSlug,
        question: input.market.question,
        bucketComparison: input.parsed.comparison,
        bucketTarget: input.parsed.targetValue,
        bucketLow: input.parsed.targetValueLow,
        bucketHigh: input.parsed.targetValueHigh,
        side: input.side,
        tokenId: input.tokenId,
        price: pt.p,
        recordedAt: new Date(pt.t * 1000),
        fidelityMinutes: input.fidelityMinutes,
        ingestJobId: input.jobId,
      }));

      try {
        await this.historyRepo()
          .createQueryBuilder()
          .insert()
          .values(rows)
          .orUpdate(
            ['price', 'fidelity_minutes', 'ingest_job_id'],
            ['condition_id', 'side', 'recorded_at'],
          )
          .execute();
        attempted += chunk.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        chunksFailed += 1;
        if (firstError === null) firstError = message;
        log.error(
          {
            err: message,
            conditionId: input.market.conditionId,
            side: input.side,
            chunkStart: i,
            chunkSize: chunk.length,
            targetDate: input.targetDate,
            city: input.city,
          },
          'weather clob history upsert chunk failed',
        );
      }
    }

    if (chunksFailed > 0) {
      throw new Error(
        `upsert_failed: ${chunksFailed} chunk(s) failed (${firstError ?? 'unknown'})`,
      );
    }

    return attempted;
  }
}
