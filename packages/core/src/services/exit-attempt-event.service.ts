import type { DataSource, EntityManager } from 'typeorm';
import {
  ExitAttemptEvent,
  type ExitAttemptKind,
} from '../entities/ExitAttemptEvent.js';
import { normalizeExitAttemptMarkBid } from '../orders/exit-attempt-mark.js';

export const EXIT_ATTEMPT_LIST_DEFAULT_LIMIT = 500;
export const EXIT_ATTEMPT_LIST_MAX_LIMIT = 2000;

export interface RecordExitAttemptInput {
  copiedPositionId: number;
  mode?: string | null;
  kind: ExitAttemptKind;
  closeReason: string;
  blockReason?: string | null;
  error?: string | null;
  executionId?: number | null;
  markBid?: number | null;
  createdAt?: Date;
}

export interface ListExitAttemptsOptions {
  limit?: number;
  offset?: number;
}

export interface ExitAttemptEventDto {
  id: number;
  copiedPositionId: number;
  kind: ExitAttemptKind;
  closeReason: string;
  blockReason: string | null;
  error: string | null;
  executionId: number | null;
  markBid: number | null;
  createdAt: string;
}

function toDto(row: ExitAttemptEvent): ExitAttemptEventDto {
  return {
    id: row.id,
    copiedPositionId: row.copiedPositionId,
    kind: row.kind,
    closeReason: row.closeReason,
    blockReason: row.blockReason,
    error: row.error,
    executionId: row.executionId,
    markBid: row.markBid,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

export class ExitAttemptEventService {
  constructor(private readonly ds: DataSource) {}

  /** Insert one journal row (call inside the same transaction as counter updates). */
  async record(
    input: RecordExitAttemptInput,
    manager?: EntityManager,
  ): Promise<ExitAttemptEvent> {
    const repo = (manager ?? this.ds).getRepository(ExitAttemptEvent);
    return repo.save(
      repo.create({
        copiedPositionId: input.copiedPositionId,
        mode: input.mode ?? null,
        kind: input.kind,
        closeReason: input.closeReason,
        blockReason: input.blockReason ?? null,
        error: input.error ?? null,
        executionId: input.executionId ?? null,
        markBid: normalizeExitAttemptMarkBid(input.markBid),
        createdAt: input.createdAt ?? new Date(),
      }),
    );
  }

  async listByPosition(
    copiedPositionId: number,
    options: ListExitAttemptsOptions = {},
  ): Promise<{ items: ExitAttemptEventDto[]; total: number }> {
    const limit = Math.min(
      Math.max(options.limit ?? EXIT_ATTEMPT_LIST_DEFAULT_LIMIT, 1),
      EXIT_ATTEMPT_LIST_MAX_LIMIT,
    );
    const offset = Math.max(options.offset ?? 0, 0);
    const repo = this.ds.getRepository(ExitAttemptEvent);

    const [rows, total] = await repo.findAndCount({
      where: { copiedPositionId },
      order: { createdAt: 'ASC', id: 'ASC' },
      take: limit,
      skip: offset,
    });

    return { items: rows.map(toDto), total };
  }
}
