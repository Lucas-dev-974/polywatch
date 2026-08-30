import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import pino from 'pino';
import type { CopyConfig } from '../entities/CopyConfig.js';
import type { CryptoConfig } from '../entities/CryptoConfig.js';
import type { WeatherConfig } from '../entities/WeatherConfig.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { getPositionMarkPrice } from '../positions/mark.js';
import {
  RESERVATION_CLOSE_REASON_EXPIRED,
  RESERVATION_CLOSE_REASON_RELEASED,
} from '../positions/reservation-close-reasons.js';
import { resolveOutcomeLabel } from '../positions/outcome.js';
import {
  getCopyMaxExposurePusd,
  getCopyMaxOpenPositions,
  getCopyMaxPositionSizePusd,
  getCryptoMaxExposurePusd,
  getCryptoMaxOpenPositions,
  getCryptoMaxPositionSizePusd,
  getWeatherMaxExposurePusd,
  getWeatherMaxOpenPositions,
  getWeatherMaxPositionSizePusd,
} from '../risk/policy.js';
import { RESERVATION_TTL_MS } from '../types/index.js';
import {
  algoKindFromReason,
  openingReasonsForAlgoKind,
  type SimAlgoKind,
} from '../simulation/algo-kind.js';
import { RiskService } from './risk.service.js';

const log = pino({ name: 'reservation-service' });

/** Entry signals that open or increase a copy position (not algo). */
const COPY_ENTRY_REASONS: readonly string[] = ['COPY_OPEN', 'COPY_INCREASE'];

/** Entry signals that create a new position in real mode. */
const REAL_ENTRY_REASONS: readonly string[] = ['COPY_OPEN', 'COPY_INCREASE', 'ALGO_OPEN', 'ALGO_INCREASE', 'WEATHER_OPEN'];
const SIM_ENTRY_REASONS: readonly string[] = ['COPY_OPEN', 'COPY_INCREASE', 'ALGO_OPEN', 'ALGO_INCREASE', 'WEATHER_OPEN'];

const IN_FLIGHT_BUY_STATUSES = ['placing', 'live_on_clob', 'partial'] as const;

// pending_resolution positions still hold capital until redemption pays out,
// so they count toward exposure and open-position limits.
const ACTIVE_STATUSES = ['pending', 'open', 'closing', 'pending_resolution'] as const;

export interface ReserveInput {
  orderSignalId: string;
  watchlistId: number;
  conditionId: string;
  assetId: string;
  mode: 'sim' | 'real';
  notionalPusd: number;
  reason: 'COPY_OPEN' | 'COPY_INCREASE' | 'ALGO_OPEN' | 'ALGO_INCREASE' | 'WEATHER_OPEN';
  moveEventId?: string;
  outcome?: string;
  /** Stop-loss as % of invested amount. */
  slPercent?: number | null;
  /** Take-profit as % of invested amount. */
  tpPercent?: number | null;
  /** Trailing drawdown as % of invested amount. */
  trailingPercent?: number | null;
  /** Trailing activation as % of invested amount. */
  trailingActivationPercent?: number | null;
  /** Strategy that opens the position (weather-algo). Null for copy/crypto/manual. */
  strategyId?: string | null;
}

export interface ReserveResult {
  reservationId: number;
  copiedPositionId: number;
  reservedNotionalPusd: number;
  expiresAt: Date;
  orderSignalId: string;
}

type ReserveLimits = {
  maxOpenPositions: number;
  maxPositionSizePusd: number;
  maxExposurePusd: number;
};

type AlgoKindConfig = CopyConfig | CryptoConfig | WeatherConfig;

function resolveReserveLimits(
  config: AlgoKindConfig,
  reason: ReserveInput['reason'],
  mode: 'sim' | 'real',
  strategyId?: string | null,
): ReserveLimits {
  const algoKind = algoKindFromReason(reason);
  switch (algoKind) {
    case 'copy':
      return {
        maxOpenPositions: getCopyMaxOpenPositions(config as CopyConfig, mode),
        maxPositionSizePusd: getCopyMaxPositionSizePusd(config as CopyConfig, mode),
        maxExposurePusd: getCopyMaxExposurePusd(config as CopyConfig, mode),
      };
    case 'weather':
      return {
        maxOpenPositions: getWeatherMaxOpenPositions(config as WeatherConfig, mode, strategyId),
        maxPositionSizePusd: getWeatherMaxPositionSizePusd(config as WeatherConfig, mode, strategyId),
        maxExposurePusd: getWeatherMaxExposurePusd(config as WeatherConfig, mode, strategyId),
      };
    default:
      return {
        maxOpenPositions: getCryptoMaxOpenPositions(config as CryptoConfig, mode),
        maxPositionSizePusd: getCryptoMaxPositionSizePusd(config as CryptoConfig, mode),
        maxExposurePusd: getCryptoMaxExposurePusd(config as CryptoConfig, mode),
      };
  }
}

export class ReservationService {
  constructor(private readonly ds: DataSource) {}

  private async countActivePositions(
    manager: EntityManager,
    mode: 'sim' | 'real',
    algoKind: SimAlgoKind,
    strategyId?: string | null,
  ): Promise<number> {
    const reasons = openingReasonsForAlgoKind(algoKind);
    const qb = manager
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.mode = :mode', { mode })
      .andWhere('p.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .andWhere('p.reason IN (:...reasons)', { reasons });
    if (algoKind === 'weather' && strategyId) {
      qb.andWhere('p.strategyId = :strategyId', { strategyId });
    }
    return qb.getCount();
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.ds.transaction(async (manager) => {
      const riskService = new RiskService(this.ds);
      const opts = { manager };
      const algoKind = algoKindFromReason(input.reason);

      const [global, copy, crypto, weather] = await Promise.all([
        riskService.getGlobalConfig(opts),
        riskService.getCopyConfig(opts),
        riskService.getCryptoConfig(opts),
        riskService.getWeatherConfig(opts),
      ]);

      const algoConfig: AlgoKindConfig =
        algoKind === 'copy' ? copy : algoKind === 'weather' ? weather : crypto;
      const limits = resolveReserveLimits(algoConfig, input.reason, input.mode, input.strategyId);

      // Defense-in-depth: ALGO_* and WEATHER_* reasons require their respective master toggles.
      if (input.reason.startsWith('ALGO_') && !crypto.cryptoAlgoEnabled) {
        throw new Error('crypto_algo_disabled');
      }
      if (input.reason.startsWith('WEATHER_') && !weather.weatherAlgoEnabled) {
        throw new Error('weather_algo_disabled');
      }

      const posRepo = manager.getRepository(CopiedPosition);
      const resRepo = manager.getRepository(PositionReservation);

      const activeCount = await this.countActivePositions(
        manager,
        input.mode,
        algoKind,
        input.strategyId,
      );

      if (
        input.mode === 'real' &&
        REAL_ENTRY_REASONS.includes(input.reason) &&
        !global.realTradingEnabled
      ) {
        throw new Error('real_trading_disabled');
      }

      if (
        input.mode === 'sim' &&
        COPY_ENTRY_REASONS.includes(input.reason) &&
        !copy.simCopyTradingEnabled
      ) {
        throw new Error('sim_copy_trading_disabled');
      }

      if (
        input.mode === 'real' &&
        COPY_ENTRY_REASONS.includes(input.reason) &&
        !copy.realCopyTradingEnabled
      ) {
        throw new Error('real_copy_trading_disabled');
      }

      if (activeCount >= limits.maxOpenPositions) {
        throw new Error('max_open_positions');
      }

      if (input.notionalPusd > limits.maxPositionSizePusd) {
        throw new Error('max_position_size');
      }

      const exposure = await this.computeExposure(
        manager,
        input.mode,
        algoKind,
        input.strategyId,
      );
      if (exposure + input.notionalPusd > limits.maxExposurePusd) {
        throw new Error('max_exposure');
      }

      // Simulation entries consume cash from the virtual balance. Active
      // reservations already hold capital until they are filled or released,
      // so they must be counted against available cash. Reject the entry before
      // creating any position to keep the simulated cash floor at zero.
      if (
        input.mode === 'sim' &&
        SIM_ENTRY_REASONS.includes(input.reason)
      ) {
        const balance = await manager.getRepository(SimulationBalance).findOne({
          where: { algoKind },
        });
        const cash = balance?.amount ?? 0;
        const activeReserved = await this.sumActiveReservedNotionalWithManager(
          manager,
          'sim',
          algoKind,
        );
        const availableCash = cash - activeReserved;
        if (input.notionalPusd > availableCash) {
          throw new Error('insufficient_cash');
        }
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
      let copiedPositionId: number;

      if (
        input.reason === 'COPY_OPEN' ||
        input.reason === 'ALGO_OPEN' ||
        input.reason === 'WEATHER_OPEN'
      ) {
        const blocking = await posRepo.findOne({
          where: {
            watchlistId: input.watchlistId,
            conditionId: input.conditionId,
            assetId: input.assetId,
            mode: input.mode,
            status: In([...ACTIVE_STATUSES]),
          },
        });
        if (blocking) {
          throw new Error('position_already_active');
        }

        const pending = posRepo.create({
          watchlistId: input.watchlistId,
          conditionId: input.conditionId,
          assetId: input.assetId,
          outcome: resolveOutcomeLabel(input.outcome),
          side: 'BUY',
          quantity: 0,
          entryPrice: 0,
          entryBidVwap: 0,
          status: 'pending',
          mode: input.mode,
          moveEventId: input.moveEventId ?? null,
          slPercent: input.slPercent ?? null,
          tpPercent: input.tpPercent ?? null,
          trailingPercent: input.trailingPercent ?? null,
          trailingActivationPercent: input.trailingActivationPercent ?? null,
          reason: input.reason,
          strategyId: input.strategyId ?? null,
        });
        const saved = await posRepo.save(pending);
        copiedPositionId = saved.id;
      } else {
        const existing = await posRepo.findOne({
          where: {
            watchlistId: input.watchlistId,
            conditionId: input.conditionId,
            assetId: input.assetId,
            mode: input.mode,
            status: 'open',
          },
        });
        if (!existing) throw new Error('no_open_position');
        copiedPositionId = existing.id;
      }

      const reservation = await resRepo.save(
        resRepo.create({
          orderSignalId: input.orderSignalId,
          copiedPositionId,
          watchlistId: input.watchlistId,
          conditionId: input.conditionId,
          assetId: input.assetId,
          mode: input.mode,
          reservedNotionalPusd: input.notionalPusd,
          reason: input.reason,
          createdAt: now,
          expiresAt,
        }),
      );

      return {
        reservationId: reservation.id,
        copiedPositionId,
        reservedNotionalPusd: input.notionalPusd,
        expiresAt,
        orderSignalId: input.orderSignalId,
      };
    });
  }

  private toReserveResult(reservation: PositionReservation): ReserveResult {
    return {
      reservationId: reservation.id,
      copiedPositionId: reservation.copiedPositionId,
      reservedNotionalPusd: reservation.reservedNotionalPusd,
      expiresAt: reservation.expiresAt,
      orderSignalId: reservation.orderSignalId,
    };
  }

  async findByOrderSignalId(
    orderSignalId: string,
  ): Promise<ReserveResult | null> {
    const reservation = await this.ds
      .getRepository(PositionReservation)
      .findOne({ where: { orderSignalId } });
    if (!reservation) return null;
    return this.toReserveResult(reservation);
  }

  /** Active ALGO_OPEN or WEATHER_OPEN reservation for a pending entry on this market leg. */
  async findActiveAlgoReservation(params: {
    watchlistId: number;
    conditionId: string;
    assetId: string;
    mode: 'sim' | 'real';
    /** Defaults to ALGO_OPEN; weather-algo passes WEATHER_OPEN. */
    reason?: 'ALGO_OPEN' | 'WEATHER_OPEN';
  }): Promise<ReserveResult | null> {
    const reservation = await this.ds
      .getRepository(PositionReservation)
      .createQueryBuilder('r')
      .innerJoin(CopiedPosition, 'p', 'p.id = r.copied_position_id')
      .where('r.watchlist_id = :watchlistId', { watchlistId: params.watchlistId })
      .andWhere('r.condition_id = :conditionId', { conditionId: params.conditionId })
      .andWhere('r.asset_id = :assetId', { assetId: params.assetId })
      .andWhere('r.mode = :mode', { mode: params.mode })
      .andWhere('r.reason = :reason', { reason: params.reason ?? 'ALGO_OPEN' })
      .andWhere('r.expires_at >= :now', { now: new Date() })
      .andWhere('p.status = :status', { status: 'pending' })
      .orderBy('r.id', 'DESC')
      .getOne();
    if (!reservation) return null;
    return this.toReserveResult(reservation);
  }

  async updateOrderSignalId(
    reservationId: number,
    orderSignalId: string,
  ): Promise<void> {
    await this.ds
      .getRepository(PositionReservation)
      .update({ id: reservationId }, { orderSignalId });
  }

  async releaseByCopiedPositionId(
    copiedPositionId: number,
    releaseReason?: string,
  ): Promise<void> {
    const reservation = await this.ds
      .getRepository(PositionReservation)
      .findOne({ where: { copiedPositionId } });
    if (!reservation) return;
    await this.release(reservation.orderSignalId, releaseReason ?? 'already_claimed');
  }

  /** Sum of non-expired reservation notionals still holding entry capital. */
  async sumActiveReservedNotional(mode: 'real' | 'sim'): Promise<number> {
    return this.sumActiveReservedNotionalWithManager(this.ds.manager, mode);
  }

  private async sumActiveReservedNotionalWithManager(
    manager: EntityManager,
    mode: 'real' | 'sim',
    algoKind?: SimAlgoKind,
  ): Promise<number> {
    const rows = await manager.getRepository(PositionReservation).find({
      where: { mode },
    });
    const now = new Date();
    const active = rows.filter(
      (r) =>
        r.expiresAt >= now &&
        (algoKind == null || algoKindFromReason(r.reason) === algoKind),
    );
    return active.reduce((sum, r) => sum + (r.reservedNotionalPusd ?? 0), 0);
  }

  async release(orderSignalId: string, releaseReason?: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const resRepo = manager.getRepository(PositionReservation);
      const posRepo = manager.getRepository(CopiedPosition);
      const reservation = await resRepo.findOne({
        where: { orderSignalId },
      });
      if (!reservation) return;

      if (await this.hasInFlightBuy(manager, reservation.copiedPositionId)) {
        return;
      }

      if (
        reservation.reason === 'COPY_OPEN' ||
        reservation.reason === 'ALGO_OPEN' ||
        reservation.reason === 'WEATHER_OPEN'
      ) {
        const pos = await posRepo.findOne({
          where: { id: reservation.copiedPositionId, status: 'pending' },
        });
        if (pos) {
          pos.status = 'cancelled';
          pos.closeReason = RESERVATION_CLOSE_REASON_RELEASED;
          pos.closedAt = pos.closedAt ?? new Date();
          await posRepo.save(pos);
          // Attribute the release to its caller so audit queries can split
          // the "reservation_released" bucket by root cause (enqueue-failed,
          // disabled-trading, already-claimed, expired, resume-abandon, …).
          log.info(
            {
              orderSignalId,
              copiedPositionId: pos.id,
              reason: reservation.reason,
              releaseReason: releaseReason ?? 'unspecified',
              reservedNotionalPusd: reservation.reservedNotionalPusd,
            },
            'reservation released — pending position cancelled',
          );
        }
      }

      await resRepo.delete({ id: reservation.id });
    });
  }

  async janitor(): Promise<number> {
    const now = new Date();
    let cleaned = 0;
    await this.ds.transaction(async (manager) => {
      const resRepo = manager.getRepository(PositionReservation);
      const posRepo = manager.getRepository(CopiedPosition);
      const expired = await resRepo
        .createQueryBuilder('r')
        .where('r.expires_at < :now', { now })
        .getMany();

      for (const r of expired) {
        if (
          r.reason === 'COPY_OPEN' ||
          r.reason === 'ALGO_OPEN' ||
          r.reason === 'WEATHER_OPEN'
        ) {
          const pos = await posRepo.findOne({
            where: { id: r.copiedPositionId, status: 'pending' },
          });
          if (pos) {
            pos.status = 'cancelled';
            pos.closeReason = RESERVATION_CLOSE_REASON_EXPIRED;
            pos.closedAt = pos.closedAt ?? now;
            await posRepo.save(pos);
            cleaned++;
          }
        }
        await resRepo.delete({ id: r.id });
      }
    });
    return cleaned;
  }

  private async hasInFlightBuy(
    manager: EntityManager,
    copiedPositionId: number,
  ): Promise<boolean> {
    const count = await manager.getRepository(Execution).count({
      where: {
        copiedPositionId,
        side: 'BUY',
        status: In([...IN_FLIGHT_BUY_STATUSES]),
      },
    });
    return count > 0;
  }

  private async computeExposure(
    manager: EntityManager,
    mode: string,
    algoKind: SimAlgoKind,
    strategyId?: string | null,
  ): Promise<number> {
    const reasons = openingReasonsForAlgoKind(algoKind);
    const posRepo = manager.getRepository(CopiedPosition);
    const posQb = posRepo
      .createQueryBuilder('p')
      .where('p.mode = :mode', { mode })
      .andWhere('p.status IN (:...statuses)', {
        statuses: ACTIVE_STATUSES,
      })
      .andWhere('p.reason IN (:...reasons)', { reasons });
    if (algoKind === 'weather' && strategyId) {
      posQb.andWhere('p.strategyId = :strategyId', { strategyId });
    }
    const positions = await posQb.getMany();

    // Expired reservations are dead weight until the janitor collects them;
    // counting them would phantom-block new entries.
    const resRepo = manager.getRepository(PositionReservation);
    const reservations = await resRepo
      .createQueryBuilder('r')
      .where('r.mode = :mode', { mode })
      .andWhere('r.expires_at >= :now', { now: new Date() })
      .getMany();

    let exposure = 0;
    for (const p of positions) {
      const mark = getPositionMarkPrice(p, p.executableBidVwap ?? 0, null);
      exposure += p.quantity * mark;
    }
    for (const r of reservations) {
      if (algoKindFromReason(r.reason) !== algoKind) continue;
      if (algoKind === 'weather' && strategyId) {
        // Reservation strategyId is not persisted; infer via the linked position.
        // If the position is missing (other strategy / not active) it must not
        // count toward this strategy's exposure.
        const pos = positions.find((p) => p.id === r.copiedPositionId);
        if (!pos || pos.strategyId !== strategyId) continue;
      }
      exposure += r.reservedNotionalPusd;
    }
    return exposure;
  }
}
