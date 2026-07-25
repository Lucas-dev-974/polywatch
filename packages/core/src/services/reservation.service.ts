import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { Execution } from '../entities/Execution.js';
import { PositionReservation } from '../entities/PositionReservation.js';
import { RiskConfig } from '../entities/RiskConfig.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { getPositionMarkPrice } from '../positions/mark.js';
import {
  RESERVATION_CLOSE_REASON_EXPIRED,
  RESERVATION_CLOSE_REASON_RELEASED,
} from '../positions/reservation-close-reasons.js';
import { resolveOutcomeLabel } from '../positions/outcome.js';
import {
  getModeMaxExposureUsdc,
  getModeMaxOpenPositions,
  getModeMaxPositionSizeUsdc,
} from '../risk/policy.js';
import { RESERVATION_TTL_MS } from '../types/index.js';
import { RiskService } from './risk.service.js';

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
  notionalUsdc: number;
  reason: 'COPY_OPEN' | 'COPY_INCREASE' | 'ALGO_OPEN' | 'ALGO_INCREASE' | 'WEATHER_OPEN';
  moveEventId?: string;
  outcome?: string;
  trailingBidPoints?: number;
  trailingActivationBidPoints?: number;
  slBidPoints?: number;
  tpBidPoints?: number;
}

export interface ReserveResult {
  reservationId: number;
  copiedPositionId: number;
  reservedNotionalUsdc: number;
  expiresAt: Date;
  orderSignalId: string;
}

export class ReservationService {
  constructor(private readonly ds: DataSource) {}

  private async countActivePositions(
    manager: EntityManager,
    mode: 'sim' | 'real',
  ): Promise<number> {
    return manager
      .getRepository(CopiedPosition)
      .createQueryBuilder('p')
      .where('p.mode = :mode', { mode })
      .andWhere('p.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .getCount();
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.ds.transaction(async (manager) => {
      const risk = await manager.getRepository(RiskConfig).findOne({ where: {} });
      if (!risk) throw new Error('Risk config not found');

      // Defense-in-depth: ALGO_* and WEATHER_* reasons require their respective master toggles.
      if (input.reason.startsWith('ALGO_') && !risk.cryptoAlgoEnabled) {
        throw new Error('crypto_algo_disabled');
      }
      if (input.reason.startsWith('WEATHER_') && !risk.weatherAlgoEnabled) {
        throw new Error('weather_algo_disabled');
      }

      const posRepo = manager.getRepository(CopiedPosition);
      const resRepo = manager.getRepository(PositionReservation);

      const activeCount = await this.countActivePositions(manager, input.mode);

      if (
        input.mode === 'real' &&
        REAL_ENTRY_REASONS.includes(input.reason) &&
        !RiskService.isRealTradingEnabledForConfig(risk)
      ) {
        throw new Error('real_trading_disabled');
      }

      if (
        input.mode === 'sim' &&
        COPY_ENTRY_REASONS.includes(input.reason) &&
        !RiskService.isSimCopyTradingEnabledForConfig(risk)
      ) {
        throw new Error('sim_copy_trading_disabled');
      }

      if (
        input.mode === 'real' &&
        COPY_ENTRY_REASONS.includes(input.reason) &&
        !RiskService.isRealCopyTradingEnabledForConfig(risk)
      ) {
        throw new Error('real_copy_trading_disabled');
      }

      if (activeCount >= getModeMaxOpenPositions(risk, input.mode)) {
        throw new Error('max_open_positions');
      }

      if (
        input.notionalUsdc > getModeMaxPositionSizeUsdc(risk, input.mode)
      ) {
        throw new Error('max_position_size');
      }

      const exposure = await this.computeExposure(
        manager,
        input.mode,
      );
      if (
        exposure + input.notionalUsdc >
        getModeMaxExposureUsdc(risk, input.mode)
      ) {
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
          where: {},
        });
        const cash = balance?.amount ?? 0;
        const activeReserved = await this.sumActiveReservedNotionalWithManager(
          manager,
          'sim',
        );
        const availableCash = cash - activeReserved;
        if (input.notionalUsdc > availableCash) {
          throw new Error('insufficient_cash');
        }
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
      let copiedPositionId: number;

      if (input.reason === 'COPY_OPEN' || input.reason === 'ALGO_OPEN') {
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
          trailingBidPoints: input.trailingBidPoints ?? null,
          trailingActivationBidPoints: input.trailingActivationBidPoints ?? null,
          slBidPoints: input.slBidPoints ?? null,
          tpBidPoints: input.tpBidPoints ?? null,
          reason: input.reason,
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
          reservedNotionalUsdc: input.notionalUsdc,
          reason: input.reason,
          createdAt: now,
          expiresAt,
        }),
      );

      return {
        reservationId: reservation.id,
        copiedPositionId,
        reservedNotionalUsdc: input.notionalUsdc,
        expiresAt,
        orderSignalId: input.orderSignalId,
      };
    });
  }

  private toReserveResult(reservation: PositionReservation): ReserveResult {
    return {
      reservationId: reservation.id,
      copiedPositionId: reservation.copiedPositionId,
      reservedNotionalUsdc: reservation.reservedNotionalUsdc,
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

  /** Active ALGO_OPEN reservation for a pending entry on this market leg. */
  async findActiveAlgoReservation(params: {
    watchlistId: number;
    conditionId: string;
    assetId: string;
    mode: 'sim' | 'real';
  }): Promise<ReserveResult | null> {
    const reservation = await this.ds
      .getRepository(PositionReservation)
      .createQueryBuilder('r')
      .innerJoin(CopiedPosition, 'p', 'p.id = r.copied_position_id')
      .where('r.watchlist_id = :watchlistId', { watchlistId: params.watchlistId })
      .andWhere('r.condition_id = :conditionId', { conditionId: params.conditionId })
      .andWhere('r.asset_id = :assetId', { assetId: params.assetId })
      .andWhere('r.mode = :mode', { mode: params.mode })
      .andWhere('r.reason = :reason', { reason: 'ALGO_OPEN' })
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

  async releaseByCopiedPositionId(copiedPositionId: number): Promise<void> {
    const reservation = await this.ds
      .getRepository(PositionReservation)
      .findOne({ where: { copiedPositionId } });
    if (!reservation) return;
    await this.release(reservation.orderSignalId);
  }

  /** Sum of non-expired reservation notionals still holding entry capital. */
  async sumActiveReservedNotional(mode: 'real' | 'sim'): Promise<number> {
    return this.sumActiveReservedNotionalWithManager(this.ds.manager, mode);
  }

  private async sumActiveReservedNotionalWithManager(
    manager: EntityManager,
    mode: 'real' | 'sim',
  ): Promise<number> {
    const rows = await manager
      .getRepository(PositionReservation)
      .createQueryBuilder('r')
      .select('SUM(r.reserved_notional_usdc)', 'total')
      .where('r.mode = :mode', { mode })
      .andWhere('r.expires_at >= :now', { now: new Date() })
      .getRawOne<{ total: string | null }>();
    return Number(rows?.total ?? 0);
  }

  async release(orderSignalId: string): Promise<void> {
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

      if (reservation.reason === 'COPY_OPEN' || reservation.reason === 'ALGO_OPEN') {
        const pos = await posRepo.findOne({
          where: { id: reservation.copiedPositionId, status: 'pending' },
        });
        if (pos) {
          pos.status = 'cancelled';
          pos.closeReason = RESERVATION_CLOSE_REASON_RELEASED;
          await posRepo.save(pos);
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
        if (r.reason === 'COPY_OPEN' || r.reason === 'ALGO_OPEN') {
          const pos = await posRepo.findOne({
            where: { id: r.copiedPositionId, status: 'pending' },
          });
          if (pos) {
            pos.status = 'cancelled';
            pos.closeReason = RESERVATION_CLOSE_REASON_EXPIRED;
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
  ): Promise<number> {
    const posRepo = manager.getRepository(CopiedPosition);
    const positions = await posRepo
      .createQueryBuilder('p')
      .where('p.mode = :mode', { mode })
      .andWhere('p.status IN (:...statuses)', {
        statuses: ACTIVE_STATUSES,
      })
      .getMany();

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
      exposure += r.reservedNotionalUsdc;
    }
    return exposure;
  }
}
