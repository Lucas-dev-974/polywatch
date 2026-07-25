import type { DataSource, EntityManager, Repository } from 'typeorm';
import { hashMoveEventId } from '../idempotence/hash.js';
import { MoveEventEntity } from '../entities/MoveEvent.js';
import { TraderSnapshot } from '../entities/TraderSnapshot.js';
import { TraderSnapshotSeq } from '../entities/TraderSnapshotSeq.js';
import { CopiedPosition } from '../entities/CopiedPosition.js';
import { WatchlistEntry } from '../entities/Watchlist.js';
import {
  requiresOpenCopiedPosition,
} from '../move-events/relevance.js';
import {
  coalesceOutcome,
  normalizeOutcome,
  resolveOutcomeLabel,
} from '../positions/outcome.js';
import { sizeDirection } from '../positions/size.js';
import type { MoveEventDto, MoveEventType, PositionSnapshot } from '../types/index.js';

type Transition = {
  conditionId: string;
  assetId: string;
  type: MoveEventType;
  previousTraderSize: number;
  traderSize: number;
  avgPrice?: number;
  outcome?: string;
};

function snapshotKey(s: PositionSnapshot): string {
  return `${s.conditionId}::${s.assetId}`;
}

/** Only UNIQUE-constraint violations are an expected idempotent skip. */
function isUniqueConstraintError(err: unknown): boolean {
  const candidates = [
    (err as { code?: string })?.code,
    (err as { driverError?: { code?: string } })?.driverError?.code,
    (err as Error)?.message,
    (err as { driverError?: { message?: string } })?.driverError?.message,
  ];
  return candidates.some(
    (c) =>
      typeof c === 'string' &&
      (c.includes('SQLITE_CONSTRAINT') || c.includes('UNIQUE constraint failed')),
  );
}

function closedTransition(
  conditionId: string,
  assetId: string,
  prev: TraderSnapshot,
  avgPrice?: number,
  incomingOutcome?: string,
): Transition {
  return {
    conditionId,
    assetId,
    type: 'CLOSED',
    previousTraderSize: prev.size,
    traderSize: 0,
    avgPrice: avgPrice ?? prev.avgPrice ?? undefined,
    outcome: coalesceOutcome(incomingOutcome, prev.outcome),
  };
}

function computeTransitions(
  existing: TraderSnapshot[],
  incoming: PositionSnapshot[],
  reconcileOnly: boolean,
  skipAbsentClosed = false,
): Transition[] {
  const existingMap = new Map(
    existing.map((e) => [
      snapshotKey({
        conditionId: e.conditionId,
        assetId: e.assetId,
        size: e.size,
        avgPrice: e.avgPrice ?? undefined,
      }),
      e,
    ]),
  );
  const incomingMap = new Map(
    incoming.filter((i) => i.size > 0).map((i) => [snapshotKey(i), i]),
  );
  // Keys reported with size 0 are handled by the explicit-close loop below
  // (which carries avgPrice/outcome); excluding them here prevents emitting
  // the same CLOSED transition twice in a single cycle.
  const zeroSizeKeys = new Set(
    incoming.filter((i) => i.size === 0).map(snapshotKey),
  );
  const transitions: Transition[] = [];

  for (const [, inc] of incomingMap) {
    const prev = existingMap.get(snapshotKey(inc));
    if (!prev) {
      if (!reconcileOnly && sizeDirection(0, inc.size) === 1) {
        transitions.push({
          conditionId: inc.conditionId,
          assetId: inc.assetId,
          type: 'OPENED',
          previousTraderSize: 0,
          traderSize: inc.size,
          avgPrice: inc.avgPrice,
          outcome: normalizeOutcome(inc.outcome),
        });
      }
    } else {
      const direction = sizeDirection(prev.size, inc.size);
      if (direction === 1 && !reconcileOnly) {
        transitions.push({
          conditionId: inc.conditionId,
          assetId: inc.assetId,
          type: 'INCREASED',
          previousTraderSize: prev.size,
          traderSize: inc.size,
          avgPrice: inc.avgPrice,
          outcome: coalesceOutcome(inc.outcome, prev.outcome),
        });
      } else if (direction === -1) {
        transitions.push({
          conditionId: inc.conditionId,
          assetId: inc.assetId,
          type: 'DECREASED',
          previousTraderSize: prev.size,
          traderSize: inc.size,
          avgPrice: inc.avgPrice,
          outcome: coalesceOutcome(inc.outcome, prev.outcome),
        });
      }
    }
  }

  for (const [key, prev] of existingMap) {
    if (skipAbsentClosed) continue;
    if (!incomingMap.has(key) && !zeroSizeKeys.has(key) && prev.size > 0) {
      transitions.push(closedTransition(prev.conditionId, prev.assetId, prev));
    }
  }

  for (const inc of incoming) {
    if (inc.size === 0) {
      const prev = existingMap.get(snapshotKey(inc));
      if (prev && prev.size > 0) {
        transitions.push(
          closedTransition(
            inc.conditionId,
            inc.assetId,
            prev,
            inc.avgPrice,
            inc.outcome,
          ),
        );
      }
    }
  }

  return transitions;
}

async function loadOpenCopiedPositionKeys(
  manager: EntityManager,
  traderAddress: string,
): Promise<Set<string>> {
  const rows = await manager
    .getRepository(CopiedPosition)
    .createQueryBuilder('p')
    .innerJoin(WatchlistEntry, 'w', 'w.id = p.watchlist_id')
    .select('p.condition_id', 'conditionId')
    .addSelect('p.asset_id', 'assetId')
    .where('w.trader_address = :traderAddress', { traderAddress })
    .andWhere('p.status IN (:...statuses)', {
      statuses: ['open', 'pending', 'closing'],
    })
    .getRawMany<{ conditionId: string; assetId: string }>();

  return new Set(rows.map((r) => `${r.conditionId}::${r.assetId}`));
}

function applySnapshotUpsert(
  snapshotRepo: Repository<TraderSnapshot>,
  traderAddress: string,
  inc: PositionSnapshot,
  existingByKey: Map<string, TraderSnapshot>,
  options: { snapshotAt: Date; snapshotSeq?: number },
  toSave: TraderSnapshot[],
): void {
  const key = snapshotKey(inc);
  const outcome = normalizeOutcome(inc.outcome);
  const existing = existingByKey.get(key);

  if (existing) {
    existing.size = inc.size;
    existing.avgPrice = inc.avgPrice ?? null;
    if (outcome) existing.outcome = outcome;
    if (options.snapshotSeq !== undefined) {
      existing.snapshotSeq = options.snapshotSeq;
    }
    existing.snapshotAt = options.snapshotAt;
    if (!toSave.includes(existing)) toSave.push(existing);
    return;
  }

  const created = snapshotRepo.create({
    traderAddress,
    conditionId: inc.conditionId,
    assetId: inc.assetId,
    outcome: outcome ?? null,
    size: inc.size,
    avgPrice: inc.avgPrice ?? null,
    snapshotSeq: options.snapshotSeq ?? 0,
    snapshotAt: options.snapshotAt,
  });
  existingByKey.set(key, created);
  toSave.push(created);
}

async function upsertTraderSnapshot(
  snapshotRepo: Repository<TraderSnapshot>,
  traderAddress: string,
  inc: PositionSnapshot,
  options: { snapshotAt: Date; snapshotSeq?: number },
): Promise<void> {
  const existing = await snapshotRepo.findOne({
    where: {
      traderAddress,
      conditionId: inc.conditionId,
      assetId: inc.assetId,
    },
  });
  const outcome = normalizeOutcome(inc.outcome);

  if (existing) {
    existing.size = inc.size;
    existing.avgPrice = inc.avgPrice ?? null;
    if (outcome) existing.outcome = outcome;
    if (options.snapshotSeq !== undefined) {
      existing.snapshotSeq = options.snapshotSeq;
    }
    existing.snapshotAt = options.snapshotAt;
    await snapshotRepo.save(existing);
    return;
  }

  await snapshotRepo.save(
    snapshotRepo.create({
      traderAddress,
      conditionId: inc.conditionId,
      assetId: inc.assetId,
      outcome: outcome ?? null,
      size: inc.size,
      avgPrice: inc.avgPrice ?? null,
      snapshotSeq: options.snapshotSeq ?? 0,
      snapshotAt: options.snapshotAt,
    }),
  );
}

async function persistCycle(
  manager: EntityManager,
  traderAddress: string,
  incoming: PositionSnapshot[],
  transitions: Transition[],
  incrementSeq: boolean,
  skipAbsentClosed = false,
): Promise<MoveEventEntity[]> {
  const snapshotRepo = manager.getRepository(TraderSnapshot);
  const seqRepo = manager.getRepository(TraderSnapshotSeq);
  const moveRepo = manager.getRepository(MoveEventEntity);

  let seqRow = await seqRepo.findOne({ where: { traderAddress } });
  if (!seqRow) {
    seqRow = seqRepo.create({ traderAddress, seq: 0 });
  }

  const candidateSeq = incrementSeq ? seqRow.seq + 1 : seqRow.seq;
  const inserted: MoveEventEntity[] = [];
  let insertedCount = 0;
  const now = new Date();

  const openCopiedKeys = await loadOpenCopiedPositionKeys(manager, traderAddress);

  for (const t of transitions) {
    if (requiresOpenCopiedPosition(t.type)) {
      const key = `${t.conditionId}::${t.assetId}`;
      if (!openCopiedKeys.has(key)) continue;
    }

    const id = hashMoveEventId({
      traderAddress,
      conditionId: t.conditionId,
      assetId: t.assetId,
      type: t.type,
      previousTraderSize: t.previousTraderSize,
      traderSize: t.traderSize,
      snapshotSeq: candidateSeq,
    });

    try {
      const entity = moveRepo.create({
        id,
        traderAddress,
        conditionId: t.conditionId,
        assetId: t.assetId,
        outcome: normalizeOutcome(t.outcome) ?? null,
        eventType: t.type,
        previousTraderSize: t.previousTraderSize,
        traderSize: t.traderSize,
        traderAvgPrice: t.avgPrice ?? null,
        snapshotSeq: candidateSeq,
        processed: false,
        detectedAt: now,
      });
      await moveRepo.insert(entity);
      inserted.push(entity);
      insertedCount++;
    } catch (err) {
      // UNIQUE conflict — idempotent skip; anything else aborts the cycle.
      if (!isUniqueConstraintError(err)) throw err;
    }
  }

  if (incrementSeq && insertedCount > 0) {
    seqRow.seq = candidateSeq;
    await seqRepo.save(seqRow);
  }

  const finalSeq = incrementSeq && insertedCount > 0 ? candidateSeq : seqRow.seq;
  const snapshotSeq = incrementSeq && insertedCount > 0 ? finalSeq : undefined;

  const persistedSnapshots = await snapshotRepo.find({ where: { traderAddress } });
  const existingByKey = new Map(
    persistedSnapshots.map((s) => [
      snapshotKey({
        conditionId: s.conditionId,
        assetId: s.assetId,
        size: s.size,
      }),
      s,
    ]),
  );
  const snapshotsToSave: TraderSnapshot[] = [];

  for (const inc of incoming) {
    applySnapshotUpsert(snapshotRepo, traderAddress, inc, existingByKey, {
      snapshotAt: now,
      snapshotSeq,
    }, snapshotsToSave);
  }

  const allIncomingKeys = new Set(incoming.map(snapshotKey));
  for (const p of persistedSnapshots) {
    if (skipAbsentClosed) continue;
    const pKey = snapshotKey({
      conditionId: p.conditionId,
      assetId: p.assetId,
      size: p.size,
    });
    if (!allIncomingKeys.has(pKey) && p.size > 0) {
      p.size = 0;
      if (snapshotSeq !== undefined) {
        p.snapshotSeq = snapshotSeq;
      }
      if (!snapshotsToSave.includes(p)) snapshotsToSave.push(p);
    }
  }

  if (snapshotsToSave.length > 0) {
    await snapshotRepo.save(snapshotsToSave);
  }

  return inserted;
}

export interface PollCycleOptions {
  /** When true, positions missing from a truncated API page must not emit CLOSED. */
  snapshotTruncated?: boolean;
}

export class PollCycleService {
  constructor(private readonly ds: DataSource) {}

  async runPollCycle(
    traderAddress: string,
    snapshot: PositionSnapshot[],
    options: PollCycleOptions = {},
  ): Promise<MoveEventDto[]> {
    const skipAbsentClosed = options.snapshotTruncated === true;
    return this.ds.transaction(async (manager) => {
      const snapshotRepo = manager.getRepository(TraderSnapshot);
      const count = await snapshotRepo.count({ where: { traderAddress } });
      if (count === 0) {
        if (skipAbsentClosed) return [];
        await this.upsertBaseline(manager, traderAddress, snapshot);
        return [];
      }

      const existing = await snapshotRepo.find({ where: { traderAddress } });
      const transitions = computeTransitions(existing, snapshot, false, skipAbsentClosed);
      const inserted = await persistCycle(
        manager,
        traderAddress,
        snapshot,
        transitions,
        true,
        skipAbsentClosed,
      );
      return inserted.map((e) => this.toDto(e));
    });
  }

  async reconcile(
    traderAddress: string,
    snapshot: PositionSnapshot[],
    options: PollCycleOptions = {},
  ): Promise<MoveEventDto[]> {
    const skipAbsentClosed = options.snapshotTruncated === true;
    return this.ds.transaction(async (manager) => {
      const snapshotRepo = manager.getRepository(TraderSnapshot);
      const count = await snapshotRepo.count({ where: { traderAddress } });
      if (count === 0) {
        if (skipAbsentClosed) return [];
        await this.upsertBaseline(manager, traderAddress, snapshot);
        return [];
      }

      const existing = await snapshotRepo.find({ where: { traderAddress } });
      const transitions = computeTransitions(existing, snapshot, true);
      const inserted = await persistCycle(
        manager,
        traderAddress,
        snapshot,
        transitions,
        false,
      );
      return inserted.map((e) => this.toDto(e));
    });
  }

  private async upsertBaseline(
    manager: EntityManager,
    traderAddress: string,
    snapshot: PositionSnapshot[],
  ): Promise<void> {
    const snapshotRepo = manager.getRepository(TraderSnapshot);
    const now = new Date();
    for (const inc of snapshot) {
      await upsertTraderSnapshot(snapshotRepo, traderAddress, inc, {
        snapshotAt: now,
        snapshotSeq: 0,
      });
    }
  }

  private toDto(e: MoveEventEntity): MoveEventDto {
    return {
      id: e.id,
      traderAddress: e.traderAddress,
      conditionId: e.conditionId,
      assetId: e.assetId,
      outcome: resolveOutcomeLabel(e.outcome),
      type: e.eventType as MoveEventType,
      traderSize: e.traderSize,
      traderAvgPrice: e.traderAvgPrice ?? 0,
      previousTraderSize: e.previousTraderSize,
      detectedAt: e.detectedAt,
      marketMeta: { title: '', endDate: '', negativeRisk: false },
    };
  }
}
